/**
 * @file alertScheduler.ts
 * @description
 * Agendador periódico de varredura dos logs de alertas por cliente,
 * com deduplicação por janela de tempo e envio opcional de notificações por e-mail.
 *
 * @remarks
 * **Variáveis de ambiente:**
 *
 * | Variável                    | Valores         | Padrão | Descrição                                      |
 * |-----------------------------|-----------------|--------|------------------------------------------------|
 * | `ALERT_SCHEDULER_ENABLED`   | `on` / `off`    | `off`  | Habilita o agendador periódico                 |
 * | `ALERT_SCHEDULER_EMAILS`    | `on` / `off`    | `off`  | Habilita o envio de e-mails nas varreduras     |
 *
 * **Ciclo de funcionamento:**
 * 1. {@link startAlertScheduler} verifica `ALERT_SCHEDULER_ENABLED`; se desativado, encerra sem criar timer.
 * 2. A cada `ALERT_INTERVAL_MS` (5 min), invoca {@link processAlerts}.
 * 3. {@link processAlerts} lê todos os arquivos de log de alertas existentes em `<cwd>/alerts/`.
 * 4. Para cada alerta de cada cliente, verifica a chave de deduplicação `<tag>-<desvio>`
 *    em `sentControlMap`. Se o alerta não foi enviado na última janela, prepara notificação.
 * 5. Se `ALERT_SCHEDULER_EMAILS=on`, envia e-mail via {@link sendEmailAlert}.
 *    Caso contrário, apenas registra o evento no console (modo observação).
 *
 * **Deduplicação interna do scheduler:**
 * Separada da deduplicação do repositório. O `sentControlMap` controla quais
 * alertas **já foram notificados** pelo scheduler, evitando spam de e-mails
 * para alertas persistentes que permanecem no arquivo de log.
 *
 * @module alerts/infrastructure/scheduling/alertScheduler
 */

import { loadAlerts } from "../../../alerts/infrastructure/storage/alertsStorage.js";
import { sendEmailAlert } from "../notifications/email/emailService.js";
import fs from "fs";
import path from "path";

/**
 * Intervalo entre varreduras do scheduler em milissegundos (5 minutos).
 *
 * @remarks
 * Controla a frequência com que {@link processAlerts} é invocada pelo `setInterval`.
 * Também serve como janela de deduplicação do scheduler: alertas com o mesmo
 * par `(tag, desvio)` não são notificados novamente antes deste intervalo expirar.
 */
const ALERT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Flag que indica se o agendador deve ser iniciado.
 *
 * @remarks
 * Derivado de `ALERT_SCHEDULER_ENABLED` (env). Qualquer valor diferente de
 * `"on"` (case-insensitive) mantém o agendador desativado (padrão: `"off"`).
 */
const SCHED_ENABLED =
  String(process.env.ALERT_SCHEDULER_ENABLED || "off").toLowerCase() === "on";

/**
 * Flag que indica se e-mails devem ser enviados durante as varreduras.
 *
 * @remarks
 * Derivado de `ALERT_SCHEDULER_EMAILS` (env). Quando `false`, o scheduler
 * opera em modo de observação: registra os eventos no console mas não envia
 * notificações (útil para depuração ou quando o envio é tratado inline).
 */
const SCHED_EMAILS =
  String(process.env.ALERT_SCHEDULER_EMAILS || "off").toLowerCase() === "on";

/**
 * Mapa de controle de notificações enviadas pelo scheduler.
 *
 * @remarks
 * Estrutura: `clientId → Map<dedupKey, lastSentTimestamp (epoch ms)>`.
 * - `dedupKey` = `"<tagName>-<desvio>"` (ex.: `"TEMP_REACTOR_01-HH"`).
 * - `lastSentTimestamp` = epoch ms da última vez que a notificação foi enviada.
 *
 * Mantido em memória: resetado ao reiniciar o processo.
 * Separado do controle de persistência em {@link alertsStorage}, pois controla
 * apenas o fluxo de **notificação**, não de **armazenamento**.
 */
const sentControlMap: Record<string, Map<string, number>> = {};

/**
 * Lista os `clientId`s que possuem arquivos de log de alertas no diretório `<cwd>/alerts/`.
 *
 * @remarks
 * Identifica arquivos pelo padrão `alerts-log-<clientId>.json`.
 * Retorna lista vazia se o diretório não existir.
 *
 * @returns {string[]}
 *   Array de `clientId`s derivados do nome dos arquivos encontrados.
 *   Retorna `[]` quando o diretório de alertas não existe.
 *
 * @example
 * ```typescript
 * // Dado que existam: alerts-log-plant-A.json, alerts-log-plant-B.json
 * getClientsWithLogs() // → ['plant-A', 'plant-B']
 * ```
 */
function getClientsWithLogs(): string[] {
  const alertsDir = path.join(process.cwd(), "alerts");
  if (!fs.existsSync(alertsDir)) return [];
  return fs
    .readdirSync(alertsDir)
    .filter((f) => f.startsWith("alerts-log-") && f.endsWith(".json"))
    .map((f) => f.replace("alerts-log-", "").replace(".json", ""));
}

/**
 * Extrai o nome da tag principal do objeto `alertData` de um alerta.
 *
 * @remarks
 * O `alertData` segue a convenção do formato legado, onde a primeira chave
 * que não pertence ao conjunto de meta-chaves (`Desvio`, `AlertsCount`)
 * é o nome da tag OPC UA monitorada.
 *
 * Retorna `'(sem tag)'` quando nenhuma chave não-meta for encontrada.
 *
 * @param {Record<string, unknown>} alertData - Objeto de dados do alerta.
 * @returns {string} Nome da tag OPC UA extraída do `alertData`, ou `'(sem tag)'`.
 *
 * @example
 * ```typescript
 * extractTagName({ TEMP_REACTOR_01: 210.5, AlertsCount: 3, Desvio: 'HH' })
 * // → 'TEMP_REACTOR_01'
 * ```
 */
function extractTagName(alertData: Record<string, any>): string {
  const KNOWN = new Set(["Desvio", "AlertsCount"]);
  const keys = Object.keys(alertData).filter((k) => !KNOWN.has(k));
  return keys[0] ?? "(sem tag)";
}

/**
 * Varre os logs de alertas de todos os clientes, aplica deduplicação por janela
 * e, se habilitado, envia notificações por e-mail.
 *
 * @remarks
 * **Deduplicação do scheduler:**
 * Cada alerta é identificado pela chave `<tagName>-<desvio>` por cliente.
 * A notificação é enviada apenas se:
 * - O alerta nunca foi notificado antes (`lastSent === 0`), **ou**
 * - O tempo desde a última notificação supera `ALERT_INTERVAL_MS` (5 min).
 *
 * **Formatação do e-mail:**
 * - Assunto: `"Alerta: <tagName> (<clientId>)"`.
 * - Corpo: descrição do instrumento, nível de desvio, ocorrências acumuladas,
 *   último valor com unidade e timestamp formatado em `pt-BR`.
 *   Campos ausentes são omitidos do corpo da mensagem.
 *
 * **Modo observação:** Quando `ALERT_SCHEDULER_EMAILS=off`, apenas registra
 * os eventos no console sem enviar e-mails (útil para debug e integração com
 * fluxo inline do `ClientManager`).
 *
 * @returns {Promise<void>} Resolve após processar todos os clientes e alertas.
 *
 * @example
 * ```typescript
 * // Execução manual (normalmente chamada pelo setInterval):
 * await processAlerts()
 * ```
 */
export async function processAlerts(): Promise<void> {
  const clients = getClientsWithLogs();
  const now = Date.now();

  for (const clientId of clients) {
    const alerts = loadAlerts(clientId);
    if (!alerts.length) continue;

    if (!sentControlMap[clientId]) {
      sentControlMap[clientId] = new Map();
    }

    for (const alert of alerts) {
      const tag = extractTagName(alert.alertData);
      const desvio = alert.alertData?.Desvio ?? "";
      const count = alert.alertData?.AlertsCount ?? "";
      const lastValue = alert.alertData?.[tag];

      /** Chave de deduplicação única por par `(tag, desvio)` no cliente. */
      const dedupKey = `${tag}-${desvio}`;
      const lastSent = sentControlMap[clientId].get(dedupKey) || 0;

      if (lastSent === 0 || now - lastSent >= ALERT_INTERVAL_MS) {
        // Formatação robusta do timestamp (protege contra valores inválidos)
        const when = new Date(alert.timestamp);
        const whenStr = isNaN(when.getTime())
          ? String(alert.timestamp)
          : when.toLocaleString("pt-BR");

        const subject = `Alerta: ${tag} (${clientId})`;
        const unit = alert.alertData?.Unidade;

        const body =
          `O instrumento "${tag}" do dispositivo "${clientId}" saiu dos limites (${desvio}).\n` +
          (count ? `Ocorrências registradas: ${count}\n` : "") +
          (lastValue != null
            ? `Último valor: ${lastValue}${unit ? ` ${unit}` : ""}\n`
            : "") +
          `Timestamp: ${whenStr}`;

        if (SCHED_EMAILS) {
          await sendEmailAlert(subject, body);
          console.log(
            `(scheduler) Email enviado para ${clientId} em ${alert.timestamp} (${dedupKey})`
          );
        } else {
          // Modo observação: e-mails a cargo do fluxo inline (ex.: ClientManager)
          console.log(
            `(scheduler) Viu ${dedupKey} @ ${whenStr} — e-mails via inline`
          );
        }

        sentControlMap[clientId].set(dedupKey, now);
      } else {
        console.log(
          `(scheduler) Ignorando repetido ${tag}/${desvio} — janela.`
        );
      }
    }
  }
}

/**
 * Inicia o agendador periódico de processamento de alertas.
 *
 * @remarks
 * **Comportamento quando desativado (`ALERT_SCHEDULER_ENABLED=off`):**
 * Registra mensagem informativa no console e retorna imediatamente,
 * sem criar nenhum timer (`setInterval`).
 *
 * **Comportamento quando ativado (`ALERT_SCHEDULER_ENABLED=on`):**
 * - Cria um `setInterval` com período `ALERT_INTERVAL_MS` (5 min).
 * - Cada tick invoca {@link processAlerts}; erros são capturados e
 *   registrados no console sem encerrar o timer.
 * - Registra no console o modo de operação (`email on` | `email off`).
 *
 * **Importação:** Deve ser chamado uma única vez no bootstrap da aplicação,
 * após a inicialização do banco de dados e do container DI.
 *
 * @returns {void}
 *
 * @example
 * ```typescript
 * // No bootstrap da aplicação:
 * startAlertScheduler()
 * // Output: "Alert Scheduler iniciado (modo: email off)"
 * ```
 */
export function startAlertScheduler(): void {
  if (!SCHED_ENABLED) {
    console.log("Alert Scheduler desativado (ALERT_SCHEDULER_ENABLED=off).");
    return;
  }
  setInterval(() => {
    processAlerts().catch((e) => console.error("Erro no processAlerts:", e));
  }, ALERT_INTERVAL_MS);
  console.log(
    "Alert Scheduler iniciado (modo:",
    SCHED_EMAILS ? "email on" : "email off",
    ")"
  );
}
