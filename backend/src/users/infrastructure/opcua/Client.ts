/**
 ** =======================================================
 @SECTION   : OPC UA Client — Coleta & Telemetria
 @FILE      : Client.ts
 @PURPOSE   : Implementar um cliente OPC UA (node-opcua) com:
              - Conexão + sessão (lifecycle)
              - Leitura periódica (polling) por NodeId
              - Normalização e montagem de payload de telemetria (tags)
              - Publicação opcional OPCUA → RabbitMQ (event envelope versionado)
              - Geração de métricas e status operacional (health/observability)
              - Integração legada com alertas/setup JSON (sem quebrar compatibilidade)
 @LAST_EDIT : 2025-11-10
 ** =======================================================
 *
 * @remarks
 * ## Visão de arquitetura (o "porquê" deste arquivo)
 * Este arquivo concentra o que é **protocolo industrial + extração de telemetria**.
 * Ele deve permanecer **agnóstico** de persistência e processamento downstream.
 *
 * Fluxo típico (pipeline):
 *  1) Conecta e mantém sessão OPC UA (node-opcua)
 *  2) Lê NodeIds (polling)
 *  3) Converte para JSON (tags)
 *  4) Publica no RabbitMQ (se habilitado)
 *  5) (Opcional/legado) dispara alertas usando setup JSON
 *
 * ## Por que ainda existe "setup/alertas" aqui?
 * Para manter compatibilidade com a versão legada do projeto:
 * - Setup JSON: mapeamento/limites por Tag
 * - Alertas: verificação de limites e notificação
 *
 * Importante: a publicação para Rabbit não depende do DB (`dbName`). Esse foi um patch
 * arquitetural importante: OPCUA → Rabbit continua existindo mesmo sem persistência local.
 *
 * ## Contrato com o restante do sistema
 * - `ClientManager` gerencia várias instâncias de `OpcuaClient`.
 * - `Launcher/Initializer` chama `initialize()` e depois define polling via:
 *   - `setPollingNodeIds()` / `applyMapMemory()`
 */

import {
  OPCUAClient,
  OPCUAClientOptions,
  ClientSession,
  MessageSecurityMode,
  SecurityPolicy,
  AttributeIds,
  TimestampsToReturn,
  makeBrowsePath,
  NodeClass
} from "node-opcua";

import fs from "node:fs";
import path from "node:path";
import { resolveAreaBySite } from "../../../config/rabbit.js";
import type { EnrichedTagValue } from "../../../messaging/types.js";

/**
 * Resolve o caminho do setup JSON do client.
 *
 * @remarks
 * Padrão adotado no projeto (conforme seus arquivos auto-gerados):
 *  - setups/<ClientId>_setuptsconfig.json
 * Ex: setups/Client01_setuptsconfig.json
 *
 * Esse setup é usado principalmente pela camada de alertas/limites e mapeamento
 * de tags para nomes amigáveis (quando o legado trabalha com Tag_01..Tag_N).
 *
 * @param clientId Identificador lógico do cliente (ex.: "Client01").
 * @returns Caminho absoluto do arquivo de setup.
 */
function resolveSetupFilePath(clientId: string): string {
  return path.resolve(process.cwd(), "setups", `${clientId}_setuptsconfig.json`);
}

/**
 * Resolve o caminho do arquivo de configuração OPC UA por clientId.
 *
 * @remarks
 * Arquivo esperado:
 *  - src/opcuaClientConfig.json
 *
 * Esse arquivo permite remover hardcode do perfil de conexão e
 * centralizar opções como:
 * - endpoint_must_exist
 * - securityMode/securityPolicy
 * - estratégia de reconexão (initialDelay/maxRetry/maxDelay)
 * - keepSessionAlive
 *
 * @returns Caminho absoluto do arquivo.
 */
function resolveOpcuaClientConfigPath(): string {
  return path.resolve(process.cwd(), "src", "opcuaClientConfig.json");
}

/**
 * Shape do arquivo opcuaClientConfig.json.
 *
 * @remarks
 * Mantido **tolerante**: tudo opcional, porque o sistema aplica fallback seguro.
 * Exemplo:
 * {
 *   "Client01": {
 *     "endpoint": "opc.tcp://localhost:4840",
 *     "initialDelay": 1000,
 *     "maxRetry": 3,
 *     "maxDelay": 30000,
 *     "securityMode": "None",
 *     "securityPolicy": "None",
 *     "keepSessionAlive": true,
 *     "endpoint_must_exist": false,
 *     "mapMemory": ["ns=3;i=1008", "..."]
 *   }
 * }
 */
type OpcuaClientConfigFile = Record<
  string,
  {
    endpoint?: string;
    namespace?: number;
    mapMemory?: string[];
    initialDelay?: number;
    maxRetry?: number;
    maxDelay?: number;
    securityMode?: number | string;
    securityPolicy?: number | string;
    keepSessionAlive?: boolean;
    endpoint_must_exist?: boolean;
  }
>;

/**
 * Cache simples do config para evitar IO repetido em reconnects.
 *
 * @remarks
 * - O cache é invalidado quando o `mtimeMs` muda (arquivo editado).
 * - Evita `readFileSync` em ciclos de reconexão ou em ambientes com muitos clients.
 */
let __opcuaCfgCache: { mtimeMs: number; data: OpcuaClientConfigFile } | null = null;

/** Sites elegiveis para simulacao de roteamento por area no RabbitMQ. */
const SIMULATED_SITES = [
  "Utilidades",
  "Recepcao",
  "Estocagem de Leite Cru",
  "Expedicao de Creme",
  "Pasteurizacao",
  "Alsafe"
] as const;

/** Janela de estabilidade do site simulado (3 segundos). */
const SITE_RANDOM_HOLD_MS = 3_000;

/** Controle interno para manter o mesmo site dentro da janela de 3 segundos. */
let __lastSiteWindow = -1;
let __lastRandomSite: string = SIMULATED_SITES[0];

/**
 * Retorna um site aleatorio, mantendo o valor fixo durante a janela de 3s.
 *
 * @returns Site sorteado para a janela atual.
 */
function getRandomSiteForWindow(): string {
  const currentWindow = Math.floor(Date.now() / SITE_RANDOM_HOLD_MS);
  if (currentWindow === __lastSiteWindow) {
    return __lastRandomSite;
  }

  __lastSiteWindow = currentWindow;
  const randomIndex = Math.floor(Math.random() * SIMULATED_SITES.length);
  let nextSite = SIMULATED_SITES[randomIndex];

  if (SIMULATED_SITES.length > 1 && nextSite === __lastRandomSite) {
    const offset = 1 + Math.floor(Math.random() * (SIMULATED_SITES.length - 1));
    nextSite = SIMULATED_SITES[(randomIndex + offset) % SIMULATED_SITES.length];
  }

  __lastRandomSite = nextSite;
  return __lastRandomSite;
}

/**
 * Lê (com cache por mtime) o arquivo src/opcuaClientConfig.json.
 *
 * @remarks
 * Regras:
 * - Se o arquivo não existir: retorna `null`
 * - Se falhar parse JSON: retorna `null`
 * - Caller decide fallback e logging (este método é "silencioso" por design)
 *
 * Motivação: este método é chamado em fluxos de connect/reconnect e não deve
 * derrubar o processo por falhas de config — o comportamento esperado é fallback.
 *
 * @returns Objeto de config por clientId, ou `null` se indisponível.
 */
function loadOpcuaClientConfig(): OpcuaClientConfigFile | null {
  const cfgPath = resolveOpcuaClientConfigPath();

  try {
    const stat = fs.statSync(cfgPath);
    if (__opcuaCfgCache && __opcuaCfgCache.mtimeMs === stat.mtimeMs) {
      return __opcuaCfgCache.data;
    }

    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = JSON.parse(raw) as OpcuaClientConfigFile;

    __opcuaCfgCache = { mtimeMs: stat.mtimeMs, data: parsed };
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Converte um valor "securityMode" vindo do JSON para o enum do node-opcua.
 *
 * @remarks
 * Aceita:
 * - string: "None" | "Sign" | "SignAndEncrypt"
 * - number (convenção comum): 1=None, 2=Sign, 3=SignAndEncrypt
 *
 * Fallback: `MessageSecurityMode.None` (seguro para simulação/dev).
 *
 * @param v Valor bruto vindo do JSON.
 * @returns Enum `MessageSecurityMode` coerente com o valor informado.
 */
function toSecurityMode(v: unknown): MessageSecurityMode {
  if (typeof v === "string") {
    const key = v.trim();
    return (MessageSecurityMode as any)[key] ?? MessageSecurityMode.None;
  }
  if (typeof v === "number") {
    if (v === 2) return MessageSecurityMode.Sign;
    if (v === 3) return MessageSecurityMode.SignAndEncrypt;
    return MessageSecurityMode.None;
  }
  return MessageSecurityMode.None;
}

/**
 * Converte um valor "securityPolicy" vindo do JSON para o enum do node-opcua.
 *
 * @remarks
 * Aceita:
 * - string: "None" | "Basic256Sha256" | ...
 * - number: depende da convenção do seu arquivo (aqui mantemos fallback seguro)
 *
 * ⚠️ Observação: se você usar números para policy no JSON,
 * você pode/should mapear explicitamente (ex.: 1=None, 2=Basic256Sha256, etc.).
 *
 * @param v Valor bruto vindo do JSON.
 * @returns Enum `SecurityPolicy` coerente com o valor informado.
 */
function toSecurityPolicy(v: unknown): SecurityPolicy {
  if (typeof v === "string") {
    const key = v.trim();
    return (SecurityPolicy as any)[key] ?? SecurityPolicy.None;
  }
  if (typeof v === "number") {
    // Ajuste este map conforme sua convenção real do JSON.
    if (v === 1) return SecurityPolicy.None;
    return SecurityPolicy.None;
  }
  return SecurityPolicy.None;
}

/**
 * Estado operacional exposto para observabilidade/diagnóstico.
 *
 * @remarks
 * Esse objeto é o "status vivo" do client e serve para:
 * - endpoints HTTP de health/status
 * - dashboards no frontend (telemetria do coletor)
 * - inspeção rápida durante incidentes
 *
 * Sinais práticos:
 * - `connected/connecting`: lifecycle
 * - `lastReadTimestamp/lastLatencyMs`: stall/latência
 * - `readFailures[nodeId]`: NodeIds problemáticos (BadNodeIdUnknown, timeouts, etc.)
 */
type OpcuaStatus = {
  connected: boolean;
  connecting: boolean;
  lastConnectTimestamp?: string;
  lastDisconnectTimestamp?: string;
  lastReadTimestamp?: string;
  lastLatencyMs?: number;
  readCount: number;
  reconnectCount: number;
  activeNodeIdsCount: number;
  lastError?: string;
  readFailures: Record<string, number>;
};

/**
 * Estatísticas agregadas por minuto (bucket rolling).
 *
 * @remarks
 * Esse mini-histórico in-memory existe para apoiar diagnóstico sem DB:
 * - quantos reads por minuto
 * - quantos status Good/Uncertain/Bad
 * - latências por read (para observar degradações)
 *
 * `latenciesMs` é mantido como array para permitir cálculo posterior (p95, p99).
 */
type BucketStats = {
  minute: string; // YYYY-MM-DDTHH:mm
  reads: number;
  good: number;
  uncertain: number;
  bad: number;
  errors: number;
  notifications: number;
  latenciesMs: number[];
};

/**
 * Cliente OPC UA que executa:
 * - conexão + sessão
 * - leitura de NodeIds (manual e automática)
 * - montagem de telemetria (tags)
 * - publicação opcional para RabbitMQ (envelope versionado)
 * - integração opcional/legada com setup JSON + alertas
 *
 * @remarks
 * ## Lifecycle recomendado
 * 1) `initialize()` (chama `connect()`)
 * 2) definir NodeIds:
 *    - `setPollingNodeIds()` ou `applyMapMemory()`
 * 3) `disconnect()` no shutdown
 *
 * ## Segurança OPC UA
 * Defaults usam `None/None` por compatibilidade com simulação e ambiente de dev.
 * Em produção, recomenda-se evoluir para Sign/SignAndEncrypt + PKI.
 */
export class OpcuaClient {
  /** Endpoint OPC UA (ex.: opc.tcp://host:4840). */
  public endpoint: string;

  /** Identificador lógico do client (ex.: Client01). Usado em logs e routingKey. */
  public clientId: string;

  /** Instância do OPCUAClient (node-opcua). Criada em `connect()`. */
  private client: OPCUAClient | null = null;

  /** Sessão OPC UA ativa. Criada após `client.connect()` e `client.createSession()`. */
  private session: ClientSession | null = null;

  /**
   * Flag interna para evitar conects duplicados.
   *
   * @remarks
   * Isso não substitui uma state machine completa, mas evita chamadas repetidas
   * de `connect()` em fluxos simples.
   */
  private connected = false;

  /**
   * Nome do banco/coleção (legado).
   *
   * @remarks
   * Mantido por compatibilidade com versões que escrevem direto no DB.
   * Hoje a telemetria via Rabbit **não depende** de `dbName`.
   */
  private dbName: string | null = null;

  /**
   * Timer do polling automático (setInterval).
   *
   * @remarks
   * - Iniciado por `startAutoRead()`
   * - Parado em `disconnect()` ou quando `startAutoRead()` é chamado novamente
   */
  private autoReadInterval: NodeJS.Timeout | null = null;

  /** Quantidade de NodeIds ativos no polling atual (indicador/observabilidade). */
  private activeNodeIdsCount = 0;

  /**
   * Lista "mapMemory" de NodeIds.
   *
   * @remarks
   * A ordem é essencial:
   * - índice i em `mapMemory` corresponde ao índice i em `dataValues`.
   * - Se `nodeIds` lidos não estiverem alinhados com `mapMemory`, tags podem “trocar” valores.
   */
  private mapMemory: string[] = [];

  /**
   * Status operacional resumido.
   *
   * @remarks
   * Usado por `getStatus()` para observabilidade.
   */
  private opcuaStatus: OpcuaStatus = {
    connected: false,
    connecting: false,
    readCount: 0,
    reconnectCount: 0,
    activeNodeIdsCount: 0,
    readFailures: {}
  };

  /**
   * Estatísticas de alertas (legado).
   *
   * @remarks
   * Esse arquivo mantém o campo para compatibilidade.
   * A atualização geralmente acontece no fluxo `checkAndSendAlerts`.
   */
  private alertStats: Record<string, any> = {};

  /** Buckets em memória (janela móvel de ~120 minutos). */
  private buckets: BucketStats[] = [];

  /** Identifica o bucket atual por minuto (YYYY-MM-DDTHH:mm). */
  private currentBucketMinute: string | null = null;

  /**
   * Construtor do client OPC UA.
   *
   * @remarks
   * Importante:
   * - `endpoint` é usado para conectar.
   * - `clientId` é usado para logs, roteamento e lookup de config.
   * - `dbName` é legado; pode ser omitido em pipeline OPCUA→Rabbit.
   *
   * @param endpoint Endpoint do servidor OPC UA (opc.tcp://...).
   * @param clientId Identificador lógico (ex.: Client01).
   * @param dbName Nome do banco/coleção (legado). Opcional.
   */
  constructor(endpoint: string, clientId: string, dbName?: string) {
    this.endpoint = endpoint;
    this.clientId = clientId;
    this.dbName = dbName ?? null;
  }

  /**
   * Garante/atualiza o bucket do minuto atual.
   *
   * @remarks
   * - Cria um bucket quando muda o minuto
   * - Mantém apenas os últimos ~120 minutos para evitar crescimento infinito
   * - Serve para métricas “de bolso” (diagnóstico rápido)
   *
   * @returns BucketStats correspondente ao minuto corrente.
   */
  private ensureCurrentBucket(): BucketStats {
    const now = new Date();
    const minute = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm

    if (this.currentBucketMinute !== minute) {
      this.currentBucketMinute = minute;
      this.buckets.push({
        minute,
        reads: 0,
        good: 0,
        uncertain: 0,
        bad: 0,
        errors: 0,
        notifications: 0,
        latenciesMs: []
      });

      if (this.buckets.length > 120) this.buckets.shift();
    }

    return this.buckets[this.buckets.length - 1];
  }

  /**
   * Conecta ao endpoint OPC UA e cria uma sessão.
   *
   * @remarks
   * Fluxo:
   * 1) monta `OPCUAClientOptions` usando defaults
   * 2) tenta carregar override de `src/opcuaClientConfig.json` (por `clientId`)
   * 3) `OPCUAClient.create(options)`
   * 4) `client.connect(endpoint)`
   * 5) `client.createSession()`
   *
   * Efeitos colaterais:
   * - atualiza `this.client`, `this.session`, `this.connected`
   * - atualiza campos em `opcuaStatus` (timestamps, flags, lastError)
   *
   * @throws Repropaga erro se não conseguir conectar/criar sessão.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      console.log(`[${this.clientId}] Já conectado.`);
      return;
    }

    this.opcuaStatus.connecting = true;

    const defaultOptions: OPCUAClientOptions = {
      endpoint_must_exist: false,
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
      connectionStrategy: { initialDelay: 1000, maxRetry: 3 },
      keepSessionAlive: true
    };

    const cfgFile = loadOpcuaClientConfig();
    const cfg = cfgFile?.[this.clientId];

    const options: OPCUAClientOptions = {
      ...defaultOptions,
      endpoint_must_exist: cfg?.endpoint_must_exist ?? defaultOptions.endpoint_must_exist,
      keepSessionAlive: cfg?.keepSessionAlive ?? defaultOptions.keepSessionAlive,
      securityMode: toSecurityMode(cfg?.securityMode),
      securityPolicy: toSecurityPolicy(cfg?.securityPolicy),
      connectionStrategy: {
        initialDelay: cfg?.initialDelay ?? defaultOptions.connectionStrategy?.initialDelay ?? 1000,
        maxRetry: cfg?.maxRetry ?? defaultOptions.connectionStrategy?.maxRetry ?? 3,
        ...(cfg?.maxDelay != null ? { maxDelay: cfg.maxDelay } : {})
      } as any
    };

    if (!cfg) {
      console.warn(
        `[${this.clientId}] opcuaClientConfig.json não possui config para este client. Usando defaults.`
      );
    }

    try {
      this.client = OPCUAClient.create(options);
      await this.client.connect(this.endpoint);
      this.session = await this.client.createSession();

      this.connected = true;
      this.opcuaStatus.connected = true;
      this.opcuaStatus.connecting = false;
      this.opcuaStatus.lastConnectTimestamp = new Date().toISOString();

      console.log(`[${this.clientId}] Conectado ao endpoint: ${this.endpoint}`);
    } catch (err) {
      this.connected = false;
      this.opcuaStatus.connected = false;
      this.opcuaStatus.connecting = false;
      this.opcuaStatus.lastError = String(err);
      console.error(`[${this.clientId}] Falha ao conectar:`, err);
      throw err;
    }
  }

  /**
   * Encerra o polling e desconecta sessão/cliente.
   *
   * @remarks
   * Ordem de shutdown (importante para evitar reads em teardown):
   * 1) parar polling (`clearInterval`)
   * 2) fechar sessão (`session.close()`)
   * 3) desconectar client (`client.disconnect()`)
   *
   * Este método **não repropaga erro** para não travar shutdown do processo.
   */
  async disconnect(): Promise<void> {
    try {
      if (this.autoReadInterval) {
        clearInterval(this.autoReadInterval);
        this.autoReadInterval = null;
      }

      if (this.session) {
        await this.session.close();
        this.session = null;
      }
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }

      this.connected = false;
      this.opcuaStatus.connected = false;
      this.opcuaStatus.lastDisconnectTimestamp = new Date().toISOString();

      console.log(`[${this.clientId}] Desconectado.`);
    } catch (err) {
      this.opcuaStatus.lastError = String(err);
      console.error(`[${this.clientId}] Erro ao desconectar:`, err);
    }
  }

  /**
   * Resolve (tenta) um identificador navegável a partir de um NodeId.
   *
   * @remarks
   * Este método existe como utilitário para cenários de “descoberta/mapeamento”
   * quando você quer derivar nomes/paths a partir de NodeIds.
   *
   * Implementação atual:
   * - usa `translateBrowsePath` com `makeBrowsePath("RootFolder", nodeId)`
   * - retorna o primeiro target encontrado (string) ou null
   *
   * ⚠️ Observação:
   * - dependendo do formato de `nodeId`, essa resolução pode não fazer sentido
   *   (porque BrowsePath costuma ser mais útil com caminhos / objetos).
   * - mantido por compatibilidade e utilidade pontual (debug).
   *
   * @param nodeId NodeId alvo (ex.: "ns=3;i=1008") ou path navegável (dependendo do server).
   * @returns String do targetId resolvido ou `null` se não resolver.
   */
  async resolveBrowseName(nodeId: string): Promise<string | null> {
    if (!this.session) return null;

    try {
      const browsePath = makeBrowsePath("RootFolder", nodeId);
      const result = await this.session.translateBrowsePath(browsePath);
      const targets = result.targets;
      if (!targets || targets.length === 0) return null;
      const targetId = targets[0].targetId.toString();
      return targetId;
    } catch {
      return null;
    }
  }

  /**
   * Define (substitui) o conjunto de NodeIds em memória para leitura.
   *
   * @remarks
   * `mapMemory` representa o “mapa” principal do client:
   * - é o conjunto de NodeIds que esperamos ler,
   * - e cuja ordem deve ser preservada para mapear `dataValues[i] → nodeId[i]`.
   *
   * Efeito colateral:
   * - atualiza `opcuaStatus.activeNodeIdsCount`.
   *
   * @param nodeIds Lista de NodeIds (ex.: ["ns=3;i=1008", "ns=3;i=1009"]).
   */
  public setMapMemory(nodeIds: string[]): void {
    this.mapMemory = [...nodeIds];
    this.opcuaStatus.activeNodeIdsCount = nodeIds.length;
  }

  /**
  * @private
  * @function loadPublishFn
  * @description
  * Carrega dinamicamente (via `import()`) a função responsável por publicar mensagens no RabbitMQ,
  * retornando uma referência estável para ser usada no restante do fluxo.
  *
  * ----------------------------------------------------------------
  * ✅ Por que isso existe?
  *
  * Este projeto pode ser executado em contextos diferentes (ex.: `ts-node`, build com `tsc`,
  * execução via `node dist/...`, paths relativos distintos, ou até ajustes de bundler).
  * Nesses cenários, o caminho real do arquivo do publisher pode variar.
  *
  * Em vez de “quebrar” o sistema por um path rígido, este método tenta múltiplas possibilidades
  * até encontrar um módulo válido exportando uma função `publish`.
  *
  * ----------------------------------------------------------------
  * 🔎 Como funciona a lista `candidates`?
  *
  * @const candidates
  * Array ordenado de *specifiers* (caminhos) que podem conter o publisher.
  *
  * O método tenta os candidatos na ordem definida:
  * 1) "../../../messaging/publisher.js" → comum após build para JS
  * 2) "../../../messaging/publisher.ts" → comum em execução direta TS (ts-node)
  * 3) "../../../messaging/publisher"    → resolução automática (Node/TS podem resolver)
  *
  * Importante:
  * - A ordem é proposital: tentamos primeiro o mais provável no modo atual.
  * - O primeiro que funcionar e expor `publish` encerra a busca.
  *
  * ----------------------------------------------------------------
  * 🔁 O que o `for (const spec of candidates)` faz?
  *
  * @param spec
  * Cada `spec` é um *module specifier* (caminho) passado para `import(spec)`.
  *
  * O loop tenta carregar (importar) o módulo de cada `spec`:
  * - se o import falhar (arquivo não existe / path errado / erro de runtime), cai no `catch`
  * - se o import funcionar, validamos se existe uma função `publish` exportada
  *
  * Esse padrão é "fail-soft": tenta alternativas sem derrubar o processo no primeiro erro.
  *
  * ----------------------------------------------------------------
  * 🧩 Como a função `publish` é encontrada no módulo?
  *
  * Este método suporta 3 formatos comuns de export:
  *
  * 1) Named export:
  *    export function publish(...) {}
  *    → acessado como `mod.publish`
  *
  * 2) Default export contendo publish:
  *    export default { publish: (...) => ... }
  *    → acessado como `mod.default.publish`
  *
  * 3) Default export sendo a própria função:
  *    export default function publish(...) {}
  *    → acessado como `mod.default`
  *
  * A resolução usada é:
  *  - mod.publish
  *  - ou mod.default.publish
  *  - ou mod.default
  *
  * Só aceitamos quando `typeof publish === "function"`.
  *
  * ----------------------------------------------------------------
  * 🧾 Por que existe `lastErr`?
  *
  * @var lastErr
  * Guarda o último erro encontrado durante as tentativas.
  *
  * Motivo:
  * - Se todos os candidates falharem, queremos lançar um erro útil,
  *   com a causa mais recente e próxima do problema real.
  *
  * Exemplo:
  * - primeiro candidate pode não existir (ENOENT)
  * - segundo pode existir mas não exportar publish
  * - terceiro pode existir mas dar erro de import (syntax/runtime)
  *
  * Ao final, lançamos o último erro para facilitar o debug.
  *
  * ----------------------------------------------------------------
  * ✅ Contrato de retorno
  *
  * @returns Função assíncrona `publish(routingKey, message)` que publica no RabbitMQ.
  * A assinatura retornada é padronizada para o restante do código não depender do módulo concreto.
  *
  * ----------------------------------------------------------------
  * ❌ Erros
  *
  * @throws
  * - Lança o último erro capturado (`lastErr`) se todos os candidates falharem.
  * - Se nenhum erro específico existir, lança erro genérico.
  */
  private async loadPublishFn(): Promise<(routingKey: string, message: any) => Promise<void>> {
    const candidates = [
      "../../../messaging/publisher.js",
      "../../../messaging/publisher.ts",
      "../../../messaging/publisher"
    ];

    let lastErr: any = null;

    for (const spec of candidates) {
      try {
        const mod = await import(spec);
        const publish =
          (mod as any).publish ??
          (mod as any).default?.publish ??
          (mod as any).default;

        if (typeof publish === "function") {
          return publish;
        }
        // Import funcionou, mas não encontramos função publish compatível
        lastErr = new Error(`publish não encontrado (named/default) em ${spec}`);
      } catch (e) {
        // Import falhou (path inválido, módulo ausente, erro de runtime)
        lastErr = e;
      }
    }

    throw lastErr ?? new Error("Falha ao carregar publisher (sem detalhes).");
  }

  /**
   * Lê valores OPC UA para um conjunto de NodeIds e executa os side-effects:
   * - atualiza métricas/buckets (observabilidade)
   * - constrói `transmitterValues` (tags)
   * - publica em RabbitMQ (se habilitado)
   * - chama alertas legados (se habilitado/possível)
   *
   * @remarks
   * ### Pré-condições
   * - `connect()` deve ter sido executado com sucesso
   * - `this.session` precisa existir
   *
   * ### Mapeamento NodeId → tagName
   * - O método lê `nodeIds` e produz `dataValues` na mesma ordem.
   * - Ele usa `this.mapMemory` para mapear:
   *   `dataValues[i]` → nodeId = `mapMemory[i]` → tagName
   *
   * Tag naming:
   * - fallback: "Tag_01", "Tag_02", ...
   * - se `clientManager.getTagNameByNodeId` existir, resolve nome amigável
   *
   * ### RabbitMQ (telemetry v1)
   * Quando `OPCUA_ENABLE_RABBIT === "true"`:
   * - monta `envMsg` = { type, version, payload }
   * - define routingKey `${prefix}.${clientId}`
   * - chama `publish(routingKey, envMsg)`
   *
   * ### Alertas (legado)
   * Se `dbName` existir e `clientManager.checkAndSendAlerts` existir:
   * - carrega setup JSON (ou cria “auto-grow”)
   * - chama `checkAndSendAlerts(clientId, transmitterValues, setupData)`
   *
   * @param nodeIds Lista de NodeIds a serem lidos no ciclo atual.
   * @returns Promise<void> (efeitos acontecem internamente; erros são tratados/logados).
   */
  async readVariables(nodeIds: string[]): Promise<void> {
    if (!this.connected || !this.session) {
      console.warn(`Cliente não está conectado ou sessão inexistente para ${this.endpoint}`);
      return;
    }

    console.log(`[${this.endpoint}] NodeIds recebidos para leitura:`, nodeIds);

    try {
      const bucket = this.ensureCurrentBucket();
      /** Valores numéricos brutos (compatibilidade com alertas legados). */
      const dataValues: (number | null)[] = [];
      /** Dados enriquecidos por NodeId (inclui metadados OPC UA). */
      const enrichedByIndex: (EnrichedTagValue | null)[] = [];
      const startReadTime = Date.now();

      // Carrega setup JSON para preencher description quando OPC UA não fornece
      let setupDescriptions: Record<number, string> = {};
      try {
        const setupPath = resolveSetupFilePath(this.clientId);
        const raw = JSON.parse(fs.readFileSync(setupPath, "utf-8"));
        if (Array.isArray(raw)) {
          raw.forEach((entry: any, i: number) => {
            if (entry?.description) setupDescriptions[i] = String(entry.description);
          });
        } else if (raw && typeof raw === "object") {
          Object.values(raw).forEach((entry: any, i: number) => {
            if (entry?.description) setupDescriptions[i] = String(entry.description);
          });
        }
      } catch { /* setup não encontrado — segue sem descriptions */ }

      // Lê sequencialmente para manter comportamento estável e simples.
      // Para cada NodeId, lê múltiplos atributos em uma única chamada.
      let nodeIndex = 0;
      for (const nodeId of nodeIds) {
        const t0 = Date.now();
        try {
          // Leitura de múltiplos atributos por NodeId
          const readRequests = [
            { nodeId, attributeId: AttributeIds.Value },
            { nodeId, attributeId: AttributeIds.BrowseName },
            { nodeId, attributeId: AttributeIds.DisplayName },
            { nodeId, attributeId: AttributeIds.Description },
            { nodeId, attributeId: AttributeIds.DataType },
          ];

          const results = await this.session.read(readRequests, TimestampsToReturn.Both);

          // Extrai atributo Value
          const valueDv = results[0];
          const v = valueDv.value?.value;
          const num = typeof v === "number" ? v : Number(v);
          const normalizedValue = Number.isFinite(num) ? num : null;
          dataValues.push(normalizedValue);

          // Extrai metadados dos demais atributos
          const browseName = results[1].value?.value?.name
            ?? String(results[1].value?.value ?? "");
          const displayName = results[2].value?.value?.text
            ?? String(results[2].value?.value ?? "");
          const rawDescription = results[3].value?.value?.text
            ?? results[3].value?.value;
          let description = typeof rawDescription === "string"
            ? (["null", "undefined", "n/a", "na", "-"].includes(rawDescription.trim().toLowerCase())
              ? ""
              : rawDescription)
            : "";

          // Fallback: se OPC UA não fornece description, usa a do setup JSON (por índice)
          if (!description.trim() && setupDescriptions[nodeIndex]) {
            description = setupDescriptions[nodeIndex];
          }

          const dataType = String(results[4].value?.value ?? "");

          const statusCode = String(valueDv.statusCode?.name || "Good");
          const sourceTimestamp = valueDv.sourceTimestamp
            ? new Date(valueDv.sourceTimestamp).toISOString()
            : null;
          const serverTimestamp = valueDv.serverTimestamp
            ? new Date(valueDv.serverTimestamp).toISOString()
            : null;

          enrichedByIndex.push({
            value: normalizedValue,
            browseName,
            displayName,
            description,
            dataType,
            statusCode,
            sourceTimestamp,
            serverTimestamp,
            minValue: null,
            maxValue: null,
          });

          // Classifica status code em buckets simples.
          const scName = statusCode;
          if (scName.includes("Bad")) bucket.bad += 1;
          else if (scName.includes("Uncertain")) bucket.uncertain += 1;
          else bucket.good += 1;

          bucket.reads += 1;
          bucket.notifications += 1;
          bucket.latenciesMs.push(Date.now() - t0);

          this.opcuaStatus.readCount += 1;
        } catch (readErr) {
          bucket.errors += 1;
          this.opcuaStatus.readFailures[nodeId] =
            (this.opcuaStatus.readFailures[nodeId] || 0) + 1;
          this.opcuaStatus.lastError = String(readErr);

          // Mantém alinhamento do array (índice importa): em caso de erro, null.
          dataValues.push(null);
          enrichedByIndex.push(null);
        }
        nodeIndex++;
      }

      this.opcuaStatus.lastReadTimestamp = new Date().toISOString();
      this.opcuaStatus.lastLatencyMs = Date.now() - startReadTime;

      console.log(dataValues);

      /**
       * `transmitterValues` é o payload enriquecido de tags:
       *  - chave = nome da tag (amigável ou fallback Tag_XX)
       *  - valor = objeto com value, browseName, displayName, description, dataType, statusCode, timestamps
       */
      const transmitterValues: Record<string, EnrichedTagValue> = {};

      /**
       * `numericValues` mantém compatibilidade com alertas legados (Record<string, number>).
       */
      const numericValues: Record<string, number> = {};

      // Tenta carregar clientManager (opcional) para resolver nomes/alertas.
      let clientManager: any = null;
      try {
        const cm = await import("./ClientManager.js");
        clientManager = (cm as any).clientManager;
      } catch {
        clientManager = null;
      }

      // Converte dataValues → transmitterValues usando mapMemory como referência.
      for (let index = 0; index < this.mapMemory.length; index++) {
        const nodeIdFromMap = this.mapMemory[index];
        const enriched = enrichedByIndex[index];

        if (!enriched) continue;

        const tagNameByIndex = `Tag_${String(index + 1).padStart(2, "0")}`;

        let resolvedName = tagNameByIndex;
        if (clientManager?.getTagNameByNodeId) {
          try {
            resolvedName =
              (await clientManager.getTagNameByNodeId(nodeIdFromMap, this.clientId)) ||
              tagNameByIndex;
          } catch {
            resolvedName = tagNameByIndex;
          }
        }

        transmitterValues[resolvedName] = enriched;

        // Mantém mapa numérico para alertas legados
        const numVal = enriched.value;
        if (typeof numVal === "number" && Number.isFinite(numVal)) {
          numericValues[resolvedName] = numVal;
        }
      }

      // Ajuda de diagnóstico quando Rabbit está ligado, mas nada foi montado.
      if (process.env.OPCUA_ENABLE_RABBIT === "true" && Object.keys(transmitterValues).length === 0) {
        console.warn(
          `[${this.clientId}] ⚠️ OPCUA_ENABLE_RABBIT=true mas transmitterValues vazio. ` +
          `mapMemory=${this.mapMemory.length} dataValues=${dataValues.length} nodeIds=${nodeIds.length}`
        );
      }

      // Publicação opcional OPCUA → Rabbit (telemetry v1)
      if (process.env.OPCUA_ENABLE_RABBIT === "true" && Object.keys(transmitterValues).length > 0) {
        let routingKey = "";
        try {
          const crypto = await import("node:crypto");
          const publish = await this.loadPublishFn();

          const msgId = crypto.randomUUID();

          /** Site funcional aplicado ao payload de telemetria (simulacao temporaria). */
          const site = getRandomSiteForWindow();
          /** Linha de producao aplicada ao payload de telemetria. */
          const line = process.env.LINE ?? "line";
          /** Host logico/fisico de origem da coleta. */
          const hostId = process.env.HOST_ID ?? this.clientId;

          const telemetry = {
            msgId,
            ts: new Date().toISOString(),
            site,
            line,
            hostId,
            clientId: this.clientId,
            tags: transmitterValues
          };

          const envMsg = {
            type: "telemetry",
            version: 1,
            payload: telemetry
          };

          /** Prefixo base de roteamento da telemetria no exchange topic. */
          const prefix = (process.env.RABBIT_ROUTING_KEY_PREFIX ?? "telemetry")
            .trim()
            .replace(/\.$/, "");

          /** Area resolvida pelo valor de site para topologia dedicada (fila/retry/dlq). */
          const area = resolveAreaBySite(site);
          /** Routing key no padrao: <prefix>.<areaSlug>.<clientId>. */
          routingKey = `${prefix}.${area.slug}.${this.clientId}`;

          console.log("🚀 [OPCUA->RABBIT] publishing", {
            routingKey,
            clientId: this.clientId,
            site,
            area: area.slug,
            tagsCount: Object.keys(transmitterValues).length
          });

          await publish(routingKey, envMsg);
        } catch (e: any) {
          console.warn(
            `[${this.clientId}] ❌ Publish falhou. routingKey=${routingKey || "(não definido)"}`,
            e?.message ?? e
          );
        }
      }

      // Alertas legados: roda apenas se existir DBName + função disponível no manager
      // Usa numericValues (Record<string, number>) para compatibilidade.
      if (dataValues.length > 0 && this.dbName && clientManager?.checkAndSendAlerts) {
        const setupPath = resolveSetupFilePath(this.clientId);

        // Carrega setup JSON (aceita formato array ou objeto)
        let setupDataObj: Record<string, any> = {};
        try {
          const raw = JSON.parse(fs.readFileSync(setupPath, "utf-8"));
          if (Array.isArray(raw)) {
            raw.forEach((entry: any, i: number) => {
              const tagName = `Tag_${String(i + 1).padStart(2, "0")}`;
              setupDataObj[tagName] = entry ?? {};
            });
          } else if (raw && typeof raw === "object") {
            setupDataObj = raw;
          }
        } catch (err) {
          console.error(`[${this.clientId}] Erro ao carregar setupJSON para alertas:`, err);
          setupDataObj = {};
        }

        // Auto-grow do setup para acompanhar quantidade de tags (compatibilidade)
        const desiredCount = this.mapMemory.length;
        const currentCount = Object.keys(setupDataObj).length;

        if (desiredCount > currentCount) {
          for (let i = currentCount; i < desiredCount; i++) {
            const tagName = `Tag_${String(i + 1).padStart(2, "0")}`;
            if (!(tagName in setupDataObj)) {
              setupDataObj[tagName] = {
                "description": "",
                "unidade": "",
                "SPAlarmL": 0,
                "SPAlarmLL": 0,
                "SPAlarmH": 0,
                "SPAlarmHH": 0
              };
            }
          }
          try {
            fs.writeFileSync(setupPath, JSON.stringify(setupDataObj, null, 2), "utf-8");
            console.info(
              `[AutoGrowSetup] client=${this.clientId} from=${currentCount} to=${desiredCount} path=${setupPath}`
            );
          } catch (e: any) {
            console.warn(`[AutoGrowSetup] Falha ao persistir crescimento do setup:`, e?.message || e);
          }
        }

        const setupData: any = setupDataObj;

        console.log(`[${this.clientId}] Chamando checkAndSendAlerts com`, numericValues);
        await clientManager.checkAndSendAlerts(this.clientId, numericValues, setupData);
        console.log(`[${this.clientId}] Finalizou checkAndSendAlerts`);
      }
    } catch (err) {
      console.error(`Erro geral ao ler variáveis em ${this.endpoint}:`, err);
      this.opcuaStatus.lastError = String(err);
    }
  }

  /**
   * Inicia (ou reinicia) o polling automático por intervalo.
   *
   * @remarks
   * - Se já existir polling, ele é cancelado e reconfigurado (idempotente).
   * - A função delega o trabalho real para `readVariables(nodeIds)`.
   * - O intervalo é baseado em `setInterval` (polling).
   *
   * Efeitos colaterais:
   * - atualiza `activeNodeIdsCount`
   * - atualiza `autoReadInterval`
   *
   * @param nodeIds NodeIds a serem lidos a cada ciclo.
   * @param intervalMs Intervalo de leitura em ms (ex.: 2000).
   */
  startAutoRead(nodeIds: string[], intervalMs: number): void {
    console.log(`[${this.endpoint}] Monitored items (autoRead) = ${this.activeNodeIdsCount}`);

    if (this.autoReadInterval) {
      clearInterval(this.autoReadInterval);
    }

    console.log(
      `[${this.endpoint}] Iniciando leitura automática a cada ${intervalMs}ms para NodeIds:`,
      nodeIds
    );

    this.activeNodeIdsCount = nodeIds.length;

    this.autoReadInterval = setInterval(() => {
      // Não await aqui para não bloquear o timer; o método trata erros internamente.
      this.readVariables(nodeIds);
    }, intervalMs);
  }

  /**
   * Retorna o status operacional do client (observabilidade).
   *
   * @remarks
   * Ideal para expor via endpoint HTTP:
   * - /health
   * - /clients/:id/status
   *
   * @returns Objeto com flags, timestamps, contadores e últimas falhas.
   */
  getStatus(): Record<string, any> {
    return this.opcuaStatus;
  }

  /**
   * Retorna estatísticas/estado do módulo de alertas (legado).
   *
   * @remarks
   * Mantido por compatibilidade com a integração de alertas.
   * Pode ser útil para debugging quando `checkAndSendAlerts` atualiza esse estado.
   *
   * @returns Estrutura livre com stats/estado de alertas.
   */
  getAlertStats(): Record<string, any> {
    return this.alertStats;
  }

  /**
   * Retorna o mapa atual de NodeIds (mapMemory).
   *
   * @remarks
   * Útil para:
   * - debug (confirmar o que o client está lendo)
   * - endpoints de inspeção
   *
   * @returns Array de NodeIds configurados.
   */
  public getMapMemory(): string[] {
    return this.mapMemory;
  }

  /**
   * Inicializa o client (alias simples do lifecycle).
   *
   * @remarks
   * No projeto atual, o initializer chama `initialize()` como passo de padronização.
   * Aqui ele simplesmente chama `connect()`.
   *
   * Futuro:
   * - usar `_appUri` para configuração de applicationUri/certificados,
   *   caso migre para modo seguro Sign/SignAndEncrypt com PKI.
   *
   * @param _appUri (Reservado) Application URI em cenários com PKI/segurança.
   */
  async initialize(_appUri?: string): Promise<void> {
    await this.connect();
  }

  /**
   * Realiza um browse em um NodeId e retorna referências de 1 nível.
   *
   * @remarks
   * Utilitário de exploração/diagnóstico:
   * - ajuda a inspecionar estrutura do servidor
   * - útil em setups para descobrir NodeIds e BrowseNames
   *
   * @param nodeId NodeId base a ser browsed (default "RootFolder").
   * @returns Lista de referências com browseName, nodeId e nodeClass.
   * @throws Erro se não houver sessão inicializada.
   */
  async browse(nodeId: string = "RootFolder") {
    if (!this.session) throw new Error("Sessão OPC UA não inicializada.");

    const browseResult = await this.session.browse(nodeId);

    return (
      browseResult.references?.map((ref) => ({
        browseName: ref.browseName?.name,
        nodeId: ref.nodeId?.toString(),
        nodeClass: NodeClass[ref.nodeClass]
      })) ?? []
    );
  }

  /**
   * Traduz uma lista de paths (BrowsePath) em NodeIds resolvidos.
   *
   * @remarks
   * Útil quando você tem caminhos “humanos” a partir do RootFolder e quer
   * obter o NodeId final resolvido.
   *
   * Implementação:
   * - para cada path, usa `translateBrowsePath(makeBrowsePath("RootFolder", p))`
   * - retorna string vazia quando não resolver (mantém alinhamento com input)
   *
   * @param paths Lista de paths a partir do RootFolder.
   * @returns Array de NodeIds resolvidos (mesmo tamanho de `paths`).
   * @throws Erro se não houver sessão inicializada.
   */
  async translatePaths(paths: string[]): Promise<string[]> {
    if (!this.session) throw new Error("Sessão OPC UA não inicializada.");

    const resolved: string[] = [];

    for (const p of paths) {
      const browsePath = makeBrowsePath("RootFolder", p);
      const result = await this.session.translateBrowsePath(browsePath);

      const nodeId = result.targets?.[0]?.targetId?.toString() ?? "";
      resolved.push(nodeId);
    }

    return resolved;
  }

  /**
   * Define NodeIds e inicia polling automático.
   *
   * @remarks
   * Atalho de alto nível para uso pelo initializer/manager:
   * - atualiza `mapMemory`
   * - inicia `startAutoRead(...)`
   *
   * @param nodeIds Lista de NodeIds a serem lidos.
   * @param intervalMs Intervalo em ms (default 2000).
   */
  setPollingNodeIds(nodeIds: string[], intervalMs = 2000): void {
    this.setMapMemory(nodeIds);
    this.startAutoRead(nodeIds, intervalMs);
  }

  /**
   * Aplica um novo mapMemory e reinicia polling automático.
   *
   * @remarks
   * Difere de `setPollingNodeIds` mais por semântica:
   * - este método sugere que o mapa já foi calculado/normalizado previamente
   *   (ex.: carregado do config JSON, gerado por initializer, etc.)
   *
   * @param newMapMemory Novo array de NodeIds (ordem importante).
   * @param intervalMs Intervalo em ms (default 2000).
   */
  applyMapMemory(newMapMemory: string[], intervalMs = 2000): void {
    this.setMapMemory(newMapMemory);
    this.startAutoRead(newMapMemory, intervalMs);
  }
}
