/**
 * @file alertsStorage.ts
 * @description
 * Camada de persistência de alertas baseada em arquivos JSON locais.
 *
 * @remarks
 * Cada cliente OPC UA possui um arquivo de log dedicado em
 * `<cwd>/alerts/alerts-log-<clientId>.json`. Os alertas são armazenados
 * como um array JSON ordenado do mais recente para o mais antigo, limitado
 * a **100 registros por cliente**.
 *
 * **Deduplicação:** Antes de salvar, verifica se já existe um alerta do mesmo
 * par `(tag, desvio)` dentro da janela de tempo controlada pela variável de
 * ambiente `ALERT_DEDUP_MS` (padrão: **5 min = 300 000 ms**). Alertas duplicados
 * dentro da janela são descartados silenciosamente.
 *
 * **Integração:** Utilizado pelo {@link startAlertScheduler} para leitura periódica e
 * pelo consumer RabbitMQ (legado) para persistência inline de alertas.
 *
 * @module alerts/infrastructure/storage/alertsStorage
 */

import fs from "fs";
import path from "path";

/**
 * Representa um único registro de alerta persistido no arquivo JSON do cliente.
 *
 * @remarks
 * O campo `alertData` segue convenção de chaves mistas:
 * - `[tagName]` — valor numérico mais recente da tag (ex.: `"TEMP_REACTOR_01": 210.5`).
 * - `AlertsCount` — número acumulado de ocorrências do alerta.
 * - `Desvio` — nível de desvio detectado (`'LL'` | `'L'` | `'H'` | `'HH'` | `'UNKNOWN'`).
 * - `Unidade` — unidade de engenharia do valor (ex.: `'°C'`, `'bar'`). Opcional.
 *
 * @property {string}                  timestamp  - Data/hora do alerta em formato ISO 8601.
 * @property {Record<string, unknown>} alertData  - Mapa de dados do alerta (tag, contagem, desvio, unidade).
 * @property {string[]}                recipients - Lista de destinatários notificados.
 * @property {string}                  clientId   - Identificador do cliente OPC UA.
 */
export type AlertEntry = {
  timestamp: string;
  alertData: Record<string, any>;
  recipients: string[];
  clientId: string;
};

/**
 * Resolve o caminho absoluto do arquivo de log de alertas para um cliente.
 *
 * @remarks
 * O arquivo é sempre armazenado em `<process.cwd()>/alerts/alerts-log-<clientId>.json`.
 * O diretório não é criado automaticamente por esta função; a criação ocorre
 * em {@link saveAlert} quando necessário.
 *
 * @param {string} clientId - Identificador único do cliente OPC UA.
 * @returns {string} Caminho absoluto do arquivo JSON de alertas do cliente.
 *
 * @example
 * ```typescript
 * getAlertsFile('plant-A')
 * // → '/app/alerts/alerts-log-plant-A.json'
 * ```
 */
function getAlertsFile(clientId: string): string {
  return path.join(process.cwd(), "alerts", `alerts-log-${clientId}.json`);
}

/**
 * Carrega e retorna a lista de alertas persistidos para um cliente.
 *
 * @remarks
 * Retorna um array vazio nos seguintes casos:
 * - O arquivo de alertas ainda não existe (primeira execução).
 * - O arquivo existe mas está vazio ou contém JSON inválido.
 * - Ocorre qualquer erro de I/O durante a leitura (erro é registrado no console).
 *
 * Esta função é **read-only** e não modifica nenhum arquivo.
 *
 * @param {string} clientId - Identificador único do cliente OPC UA.
 * @returns {AlertEntry[]}
 *   Array de {@link AlertEntry} do cliente, ordenado do mais recente para o mais antigo.
 *   Retorna `[]` se o arquivo não existir ou ocorrer qualquer erro de leitura.
 *
 * @example
 * ```typescript
 * const alerts = loadAlerts('plant-A')
 * console.log(`${alerts.length} alertas encontrados.`)
 * ```
 */
export function loadAlerts(clientId: string): AlertEntry[] {
  const filePath = getAlertsFile(clientId);
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content || "[]");
  } catch (error) {
    console.error(`Erro ao carregar alertas para ${clientId}:`, error);
    return [];
  }
}

/**
 * Persiste um alerta no arquivo JSON do cliente, aplicando deduplicação temporal.
 *
 * @remarks
 * **Algoritmo de deduplicação:**
 * 1. Identifica o par `(tag, desvio)` do alerta recebido.
 * 2. Verifica se já existe algum alerta com o mesmo par cujo `timestamp` esteja
 *    dentro da janela `ALERT_DEDUP_MS` (env, padrão: **300 000 ms = 5 min**).
 * 3. Se existir, descarta o alerta e retorna `false`.
 * 4. Se não existir, insere o alerta no início da lista (`unshift`),
 *    limita o array a **100 registros** (`pop` do excedente) e persiste o arquivo.
 *
 * **Criação de diretório:** Cria `<cwd>/alerts/` automaticamente caso não exista.
 *
 * **Formato do arquivo:** JSON indentado com 2 espaços para facilitar leitura humana.
 *
 * @param {AlertEntry} alert - Objeto de alerta a ser persistido.
 *   - `alert.clientId` — determina qual arquivo JSON será atualizado.
 *   - `alert.alertData` — primeira chave do objeto é interpretada como `tagName`.
 *   - `alert.alertData.Desvio` — nível de desvio usado na chave de deduplicação.
 *
 * @returns {boolean}
 *   `true` se o alerta foi salvo com sucesso (novo registro);
 *   `false` se foi suprimido pela deduplicação (duplicata dentro da janela).
 *
 * @example
 * ```typescript
 * const saved = saveAlert({
 *   timestamp: new Date().toISOString(),
 *   clientId: 'plant-A',
 *   alertData: { TEMP_REACTOR_01: 210.5, AlertsCount: 3, Desvio: 'HH', Unidade: '°C' },
 *   recipients: ['ops@company.com'],
 * })
 *
 * if (saved) {
 *   console.log('Alerta persistido no arquivo JSON.')
 * } else {
 *   console.log('Alerta suprimido por deduplicação.')
 * }
 * ```
 */
export function saveAlert(alert: AlertEntry): boolean {
  const filePath = getAlertsFile(alert.clientId);

  /** Cria o diretório `./alerts/` se ainda não existir. */
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log("Diretório de alertas criado:", dir);
  }

  const alerts = loadAlerts(alert.clientId);

  /** Nome da tag: primeira chave do `alertData` por convenção do formato legado. */
  const tag = Object.keys(alert.alertData)[0];
  const desvio = alert.alertData.Desvio;
  const now = new Date(alert.timestamp);

  /** Janela de deduplicação em ms: env `ALERT_DEDUP_MS` ou padrão 5 min. */
  const DEDUP_MS = Number(process.env.ALERT_DEDUP_MS ?? 5 * 60 * 1000);

  /** Verifica se já existe alerta do mesmo `(tag, desvio)` dentro da janela. */
  const alreadyExists = alerts.some((a) => {
    const existingTag = Object.keys(a.alertData)[0];
    const existingDesvio = a.alertData.Desvio;
    const existingTime = new Date(a.timestamp);
    return (
      existingTag === tag &&
      existingDesvio === desvio &&
      now.getTime() - existingTime.getTime() < DEDUP_MS
    );
  });

  if (alreadyExists) {
    console.log(
      `Ignorado: (${tag}, ${desvio}) já registrado nos últimos ${Math.round(
        DEDUP_MS / 60000
      )} min.`
    );
    return false;
  }

  /** Insere no início (mais recente primeiro) e limita a 100 registros. */
  alerts.unshift(alert);
  if (alerts.length > 100) alerts.pop();

  fs.writeFileSync(filePath, JSON.stringify(alerts, null, 2), "utf-8");
  console.log(`Alerta salvo para ${alert.clientId} em ${filePath}`);
  return true;
}
