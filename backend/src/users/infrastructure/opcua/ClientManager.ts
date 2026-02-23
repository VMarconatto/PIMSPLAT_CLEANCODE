/**
** =======================================================
@SECTION : OPC UA Client Manager — Orquestração Multi-Client
@FILE : ClientManager.ts
@PURPOSE : Gerenciar múltiplos clientes OPC UA, preparar MongoDB, mapear Tag↔NodeId e acionar alertas (sem alterar lógica).
@LAST_EDIT : 2025-11-10
** =======================================================
*/

import { OpcuaClient } from "./Client.js";
// import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { OPCUAClientOptions } from "node-opcua";
import { resolveSetupFilePath } from "../../../telemetry/app/launchers/SetupInitializer.js";
import fs from "fs";
import path from "path";

import { sendEmailAlert } from "../../../alerts/infrastructure/notifications/email/emailService.js"
import { publish } from "../../../messaging/publisher.js";
import { resolveAreaBySite } from "../../../config/rabbit.js";
import type { AlertMessage, Envelope } from "../../../messaging/types.js";

dotenv.config();
process.env.DEBUG = "mongodb";

/** Tipo de desvio usado na avaliação de limites. */
type Desvio = "LL" | "L" | "H" | "HH";

/** Estatísticas in-memory por Tag (para deduplicação/envio). */
type TagStats = {
  count: number;
  lastValue: number;
  lastSentByDesvio: Partial<Record<Desvio, number>>;
  countByDesvio: Partial<Record<Desvio, number>>;
  lastPublishedCountByDesvio: Partial<Record<Desvio, number>>;
};

/**
 * Orquestrador de {@link OpcuaClient} — mantém o registro de clientes, provê serviços
 * cruzados (Mongo, alertas, resolução de Tag por NodeId) e utilitários de navegação.
 */
export class ClientManager {
  /** Mapa de clientes registrados (id → OpcuaClient). */
  private clients: Map<string, OpcuaClient> = new Map();
  /** Resolve a promise quando qualquer Mongo conectar. */
  private mongoReadyResolve!: () => void;

  /**
   * ✅ PATCH (anti-spam): guarda quais setups ausentes já foram avisados,
   * para não poluir o log a cada ciclo de polling.
   */
  private missingSetupWarned: Set<string> = new Set();

  /** Promise aguardada por clientes que precisam de Mongo pronto. */
  private isMongoEnabled(): boolean {
    return process.env.OPCUA_ENABLE_MONGO === "true";
  }

  private mongoReadyPromise: Promise<void>;

  constructor() {
    this.mongoReadyPromise = new Promise<void>((resolve) => {
      this.mongoReadyResolve = resolve;
    });

    // ✅ Se Mongo não é parte do teste OPC UA, NÃO bloqueia startup.
    if (!this.isMongoEnabled()) {
      console.log("[ClientManager] Mongo desabilitado. Liberando mongoReadyPromise imediatamente.");
      this.mongoReadyResolve();
    }
  }

  /**
   * Registra um novo cliente OPC UA.
   * @param id Identificador lógico (ex.: "Client01")
   * @param endpoint URL opc.tcp do servidor
   * @param mapMemory Lista crua de NodeIds
   * @param options Opções do SDK OPC UA
   * @param namespace Namespace padrão (default 3)
   */
  addClient(
    id: string,
    endpoint: string,
    mapMemory: string[] = [],
    options: OPCUAClientOptions = {},
    namespace: number = 3
  ) {
    if (this.clients.has(id)) {
      console.warn(`Cliente '${id}' já existe.`);
      return;
    }

    const client = new OpcuaClient(endpoint, id);
    client.setMapMemory(mapMemory);

    this.clients.set(id, client);
  }

  /** Obtém um cliente pelo id (ou `undefined` se não existir). */
  getClient(id: string): OpcuaClient | undefined {
    return this.clients.get(id);
  }

  /**
   * Snapshot de status de todos os clientes (`getStatus`).
   * @returns Mapa id → status
   */
  getAllClients(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [id, client] of this.clients.entries()) {
      result[id] = client.getStatus();
    }
    return result;
  }

  getAllClientEntries(): IterableIterator<[string, OpcuaClient]> {
    return this.clients.entries();
  }

  /** Remove e desconecta um cliente. */
  removeClient(id: string) {
    const client = this.clients.get(id);
    if (client) {
      client.disconnect().then(() => {
        this.clients.delete(id);
        console.log(`Cliente ${id} removido.`);
      });
    }
  }

  /**
   * Retorna estatísticas de alertas de todos os clientes.
   * @returns Mapa id → stats
   */
  getAllAlertStats(): Record<string, any> {
    const allStats: Record<string, any> = {};
    for (const [id, client] of this.clients.entries()) {
      allStats[id] = client.getAlertStats();
    }
    return allStats;
  }

  /** Retorna estatísticas de alertas de um cliente específico. */
  getAlertStats(clientId: string): Record<string, any> {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Client ${clientId} não encontrado.`);
    return client.getAlertStats();
  }

  /**
   * Retorna o "nome da tag" (a chave do setup JSON) associada a um nodeId, para um client.
   * Estratégia atual: match por ÍNDICE (ordem do mapMemory) — normalizando NodeIds.
   *
   * ✅ PATCH (Opção B):
   * - Se o setup não existir (ENOENT), NÃO tenta ler e NÃO gera spam no log.
   * - Retorna fallback "Tag_XX" baseado no índice do mapMemory.
   *
   * @param nodeId NodeId alvo (diversos formatos aceitos)
   * @param clientId Id lógico do cliente
   * @returns Nome canônico (ex.: "Tag_07") ou `undefined` se não encontrado
   */
  getTagNameByNodeId(nodeId: string, clientId: string): string | undefined {
    const client = this.clients.get(clientId);
    if (!client) return undefined;

    // normaliza nodeId (ignora ns=)
    const normalize = (id: string) => {
      const s = String(id).trim();
      const after = s.includes(";") ? s.slice(s.indexOf(";") + 1) : s;
      if (/^\d+$/.test(after)) return `i=${after}`;
      if (/^(i|s|b|g|o)=/i.test(after)) return after;
      return after;
    };

    const target = normalize(nodeId);
    const mapMemory = client.getMapMemory();
    const ns = 3;

    const index = mapMemory.findIndex((raw: string) => {
      const r = String(raw).trim();
      const variants = [r, `ns=${ns};${r}`, normalize(r), normalize(`ns=${ns};${r}`)];
      return variants.some(v => normalize(v) === target);
    });

    if (index < 0) {
      // Sem índice, não há como mapear para Tag_XX.
      // ✅ Sem spam
      return undefined;
    }

    // fallback sempre possível pelo índice do mapMemory
    const fallbackTag = `Tag_${String(index + 1).padStart(2, "0")}`;

    const setupPath = resolveSetupFilePath(clientId);

    /**
     * ✅ PATCH principal:
     * Se o setup não existe ainda, não tenta ler (evita ENOENT repetitivo).
     * Loga só uma vez por client/path e retorna fallback Tag_XX.
     */
    if (!fs.existsSync(setupPath)) {
      const warnKey = `${clientId}:${setupPath}`;
      if (!this.missingSetupWarned.has(warnKey)) {
        this.missingSetupWarned.add(warnKey);
        console.warn(
          `[TagNameLookup] Setup não encontrado. Usando fallback por índice. client=${clientId} path=${setupPath}`
        );
      }
      return fallbackTag;
    }

    try {
      const setupData = JSON.parse(fs.readFileSync(setupPath, "utf-8"));
      const tagNames = Array.isArray(setupData)
        ? setupData.map((_: any, i: number) => `Tag_${String(i + 1).padStart(2, "0")}`)
        : Object.keys(setupData);

      console.info(
        `[TagNameLookup] client=${clientId} nodeId=${target} idx=${index} mapMemoryLen=${mapMemory.length} setupLen=${tagNames.length} path=${setupPath}`
      );

      const name = tagNames[index];
      if (!name) {
        console.warn(
          `[TagNameLookup] setup too short. need>=${index + 1} has=${tagNames.length}. Usando fallback=${fallbackTag}`
        );
        return fallbackTag;
      }

      return name;
    } catch (err) {
      console.error(`Erro ao ler setup '${setupPath}':`, err);
      // ✅ Mesmo com JSON quebrado, mantém o sistema rodando sem spam
      return fallbackTag;
    }
  }

  /**
   * Verifica limites para cada tag e:
   * - atualiza estatísticas (count/lastValue/lastSentByDesvio)
   * - grava alerta no PostgreSQL (via ProcessAlertsUseCase, com dedup)
   * - envia e-mail apenas quando houve novo registro
   * @param clientId Id do cliente
   * @param values Mapa TagName→valor (ou nodeId→valor)
   * @param setupData Conteúdo do setup JSON
   */
  async checkAndSendAlerts(
    clientId: string,
    values: Record<string, number>,
    setupData: Record<string, any>
  ) {
    console.log("checkAndSendAlerts foi chamada");
    const now = Date.now();
    const DEDUP_MS = Number(process.env.ALERT_DEDUP_MS ?? 5 * 60 * 1000);

    const client = this.clients.get(clientId);
    if (!client) return;

    const stats: Record<string, TagStats> = client.getAlertStats();

    // helper: extrai nodeId de chaves como "Tag-ns=3;i=1057" ou usa a própria chave quando já for nodeId
    const extractNodeId = (raw: string): string | null => {
      if (typeof raw !== "string" || !raw) return null;
      if (raw.startsWith("Tag-")) return raw.slice(4); // "Tag-ns=3;i=1057" -> "ns=3;i=1057"
      if (/^ns=\d+;/.test(raw)) return raw;            // "ns=3;i=1057"
      if (/^\d+$/.test(raw)) return raw;               // "1057"
      if (/^(i|s|b|g|o)=/i.test(raw)) return raw;      // "i=1057", "s=MyVar", etc.
      return null;
    };

    for (const incomingKey in values) {
      const value = values[incomingKey];

      // 1) tenta direto (ex.: Tag_07 já bate com o setup)
      let canonicalKey = incomingKey;
      let config = setupData?.[canonicalKey];

      // 2) se não achou no setup, tenta resolver pelo nodeId → Tag_XX
      if (!config) {
        const maybeNodeId = extractNodeId(incomingKey);
        if (maybeNodeId) {
          try {
            const mapped = this.getTagNameByNodeId(maybeNodeId, clientId); // retorna "Tag_XX" se achar o índice
            if (mapped && setupData?.[mapped]) {
              canonicalKey = mapped;
              config = setupData[mapped];
            }
          } catch (e) {
            console.warn(`[${clientId}] Falha ao mapear '${incomingKey}' via getTagNameByNodeId:`, (e as any)?.message || e);
          }
        }
      }

      // 3) se ainda não achou, registra aviso e segue para a próxima
      if (!config) {
        console.warn(`[${clientId}] Tag '${incomingKey}' não encontrada no setupData`);
        continue;
      }

      // tenta várias chaves comuns para unidade
      const unidade: string =
        config?.unit ??
        config?.Unit ??
        config?.unidade ??
        config?.engineeringUnit ??
        config?.engUnit ??
        "";

      const { SPAlarmH, SPAlarmHH, SPAlarmL, SPAlarmLL } = config;

      let desvio: Desvio | null = null;
      if (SPAlarmHH !== undefined && value >= SPAlarmHH) desvio = "HH";
      else if (SPAlarmH !== undefined && value >= SPAlarmH) desvio = "H";
      else if (SPAlarmLL !== undefined && value <= SPAlarmLL) desvio = "LL";
      else if (SPAlarmL !== undefined && value <= SPAlarmL) desvio = "L";

      if (!desvio) continue;

      // estatísticas por chave CANÔNICA (Tag_XX), não pela chave de entrada
      const stat = stats[canonicalKey] || {
        count: 0,
        lastValue: 0,
        lastSentByDesvio: {},
        countByDesvio: {},
        lastPublishedCountByDesvio: {},
      };
      if (!stat.lastSentByDesvio) stat.lastSentByDesvio = {};
      if (!stat.countByDesvio) stat.countByDesvio = {};
      if (!stat.lastPublishedCountByDesvio) stat.lastPublishedCountByDesvio = {};
      stat.count++;
      stat.countByDesvio[desvio] = (stat.countByDesvio[desvio] || 0) + 1;
      stat.lastValue = value;

      const lastSent = stat.lastSentByDesvio[desvio] || 0;
      const elapsed = now - lastSent;

      if (lastSent === 0 || elapsed >= DEDUP_MS) {
        console.log(`Novo alerta para ${canonicalKey} — desvio: ${desvio}`);

        const ts = new Date().toISOString();
        const recipients = [process.env.ALERT_EMAIL_DESTINATION || "destinatario@exemplo.com"];
        const totalCountForDesvio = stat.countByDesvio[desvio] || 0;
        const lastPublishedCountForDesvio = stat.lastPublishedCountByDesvio[desvio] || 0;
        const occurrencesInWindow = Math.max(
          1,
          totalCountForDesvio - lastPublishedCountForDesvio
        );

        // Publica alerta no RabbitMQ (mesmo padrão da telemetria)
        const crypto = await import("node:crypto");
        const alertPayload: AlertMessage = {
          msgId: crypto.randomUUID(),
          ts,
          site: process.env.SITE ?? "default",
          clientId,
          tagName: canonicalKey,
          value,
          desvio,
          alertsCount: occurrencesInWindow,
          unidade,
          recipients,
        };

        const envelope: Envelope<AlertMessage> = {
          type: "alert",
          version: 1,
          payload: alertPayload,
        };

        const site = process.env.SITE ?? "default";
        const area = resolveAreaBySite(site);
        const routingKey = `alerts.${area.slug}.${clientId}`;

        try {
          await publish(routingKey, envelope);
          console.log(`[ALERT][PUBLISHED]`, { routingKey, clientId, tagName: canonicalKey, desvio });
        } catch (pubErr) {
          console.error(`[ALERT][PUBLISH_FAILED]`, { routingKey, clientId, error: (pubErr as any)?.message || pubErr });
        }

        // Envia email (dedup in-memory já garantido acima)
        const valorFmt = `${value}${unidade ? ` ${unidade}` : ""}`;
        sendEmailAlert(
          `Alerta ${desvio}: ${canonicalKey} (${clientId})`,
          `O instrumento "${canonicalKey}" do dispositivo "${clientId}" saiu dos limites (${desvio}).\n` +
          `Ocorrências registradas: ${occurrencesInWindow}\n` +
          `Último valor: ${valorFmt}\n` +
          `Timestamp: ${new Date().toLocaleString("pt-BR")}`
        );
        stat.lastSentByDesvio[desvio] = now;
        stat.lastPublishedCountByDesvio[desvio] = totalCountForDesvio;
      } else {
        console.log(`Ignorado por janela in-memory (${Math.round((DEDUP_MS - elapsed) / 1000)}s) para ${canonicalKey}/${desvio}`);
      }

      stats[canonicalKey] = stat;
    }
  }

  /** Aguarda até que algum cliente Mongo esteja conectado (quando habilitado). */
  async waitForAnyMongoConnected(): Promise<void> {
    if (!this.isMongoEnabled()) return;
    await this.mongoReadyPromise;
  }

  /**
   * Prepara MongoDB (DB/coleções), cria cliente `MongoClient` e tenta conectar com retry/ping.
   * Define `dbName`/`collections` no {@link OpcuaClient} correspondente.
   * @param id Id lógico do cliente
   */
  // async prepareMongoForClient(id: string) {
  //   const client = this.clients.get(id);
  //   if (!client) return;

  //   const clientIndex = [...this.clients.keys()].indexOf(id) + 1;
  //   client.dbName = `Client${String(clientIndex).padStart(2, "0")}`;
  //   client.collections = {
  //     transmiters: `${client.dbName}_Transmiters`,
  //     valves: `${client.dbName}_Valves`,
  //     motors: `${client.dbName}_Motors`,
  //   };

  //   const uri = process.env.connectionstring3;
  //   if (!uri) throw new Error("connectionstring3 não definida");

  //   const attemptConnect = async () => {
  //     try {
  //       await Promise.race([
  //         client.mongoClient.connect(),
  //         new Promise((_, reject) =>
  //           setTimeout(() => reject(new Error("Timeout conexão MongoDB")), 30000)
  //         ),
  //       ]);

  //       await client.mongoClient.db("admin").command({ ping: 1 });

  //       const db = client.mongoClient.db(client.dbName);
  //       if (client.collections) {
  //         for (const collection of Object.values(client.collections)) {
  //           const exists = await db.listCollections({ name: collection }).hasNext();
  //           if (!exists) await db.createCollection(collection);
  //         }
  //       }

  //       client.mongoConnected = true;
  //       client.startMongoPing(60000);

  //       if (this.mongoReadyResolve) {
  //         this.mongoReadyResolve();
  //         this.mongoReadyResolve = null!;
  //       }
  //     } catch (err) {
  //       console.error(`[${client.dbName}] Erro ao conectar MongoDB:`, err);
  //       client.mongoConnected = false;
  //       setTimeout(attemptConnect, 5000);
  //     }
  //   };

  //   await attemptConnect();
  // }

  /** Encaminha *browse* para o cliente. */
  async browse(clientId: string, nodeId?: string) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Client ${clientId} não encontrado.`);
    return await client.browse(nodeId || "RootFolder");
  }

  /** Encaminha *translatePaths* para o cliente. */
  async translatePaths(clientId: string, paths: string[]) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Client ${clientId} não encontrado.`);
    return await client.translatePaths(paths);
  }

  /** Atualiza NodeIds de polling de um cliente. */
  setPollingNodeIds(clientId: string, nodeIds: string[], intervalMs = 2000) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Client ${clientId} não encontrado.`);
    client.setPollingNodeIds(nodeIds, intervalMs);
  }

  /** Aplica novo `mapMemory` bruto a um cliente (recompõe NodeIds). */
  updateMapMemory(clientId: string, newMapMemory: string[], intervalMs = 2000) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Client ${clientId} não encontrado.`);
    client.setMapMemory(newMapMemory);
    client.startAutoRead(newMapMemory, intervalMs);
  }
}

/** Instância exportada (singleton) do orquestrador. */
export const clientManager = new ClientManager();
