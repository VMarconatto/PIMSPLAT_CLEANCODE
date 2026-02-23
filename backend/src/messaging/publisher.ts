import { rabbitConfig } from "../config/rabbit.js";
import { getRabbitConnection } from "./rabbitmq.connection.js";
import type { Envelope } from "./types.js";
import pino from "pino";

/**
 * @file publisher.ts
 * @module infrastructure/rabbit/publisher
 *
 * @description
 * Camada responsável por publicar mensagens no RabbitMQ dentro
 * do pipeline de telemetria industrial.
 *
 * ───────────────────────────────────────────────────────────────
 * 🔁 Papel no Pipeline
 * ───────────────────────────────────────────────────────────────
 * OPC UA MultiClient (Producer)
 *          ↓
 *     publish()
 *          ↓
 *     RabbitMQ Exchange
 *          ↓
 *     Queue(s)
 *          ↓
 *     Consumer Worker
 *
 * Este módulo é o ponto oficial de saída das mensagens da aplicação
 * para o broker RabbitMQ.
 *
 * Ele NÃO conhece regras de negócio.
 * Ele NÃO conhece banco de dados.
 * Ele apenas publica envelopes versionados de forma confiável.
 *
 * ───────────────────────────────────────────────────────────────
 * 📦 Contrato de Mensagem
 * ───────────────────────────────────────────────────────────────
 * Toda mensagem deve respeitar o tipo Envelope<T>, que garante:
 *
 * - version        → versão do envelope (ex: "v1")
 * - type           → tipo semântico do evento
 * - timestamp      → momento lógico do evento
 * - payload        → dados reais da telemetria
 *
 * Isso permite:
 * - versionamento evolutivo
 * - compatibilidade futura
 * - auditoria de eventos
 * - rastreabilidade por tipo
 *
 * ───────────────────────────────────────────────────────────────
 * 🛡 Garantias Oferecidas
 * ───────────────────────────────────────────────────────────────
 * - deliveryMode: 2 → mensagem persistente
 * - contentType: application/json
 * - publisher confirm (waitForConfirms) se canal suportar
 * - log estruturado (pino)
 *
 * ───────────────────────────────────────────────────────────────
 * ⚠ Limitações
 * ───────────────────────────────────────────────────────────────
 * - Não implementa retry automático no publisher
 * - Não controla backpressure explicitamente
 * - Não valida schema do envelope (espera que venha validado)
 *
 * Confiabilidade final depende de:
 * - exchange configurado como durável
 * - filas duráveis
 * - consumer com ack correto
 */

const log = pino({ name: "publisher" });

/**
 * Publica uma mensagem no exchange configurado do RabbitMQ.
 *
 * @template T Tipo do payload dentro do Envelope.
 *
 * @param routingKey
 * Routing key usada pelo exchange para rotear a mensagem
 * para a fila correta.
 *
 * Em arquitetura industrial multi-client,
 * normalmente segue padrão como:
 *
 *   telemetry.client01
 *   telemetry.client02
 *   telemetry.alert
 *
 * @param message
 * Envelope<T> versionado contendo metadados e payload.
 *
 * Deve estar serializável em JSON.
 *
 * ───────────────────────────────────────────────────────────────
 * 🔄 Fluxo Interno
 * ───────────────────────────────────────────────────────────────
 * 1. Obtém canal via getRabbitConnection()
 * 2. Log estruturado da publicação
 * 3. Serializa envelope para Buffer JSON
 * 4. Publica no exchange com:
 *      - persistent deliveryMode
 *      - timestamp
 *      - contentType
 * 5. Aguarda confirmação do broker (se canal confirm)
 *
 * ───────────────────────────────────────────────────────────────
 * 📊 Observabilidade
 * ───────────────────────────────────────────────────────────────
 * Loga:
 * - exchange
 * - routingKey
 * - type
 * - version
 * - clientId (extraído do payload se existir)
 *
 * Isso permite:
 * - auditoria
 * - rastreamento por cliente
 * - debugging de pipeline
 *
 * ───────────────────────────────────────────────────────────────
 * 🧠 Considerações de Backpressure
 * ───────────────────────────────────────────────────────────────
 * channel.publish() retorna boolean:
 *
 * true  → buffer interno aceitou mensagem
 * false → buffer cheio (aplicação deve considerar controle)
 *
 * Este método retorna esse boolean para que
 * camadas superiores possam decidir se precisam
 * aplicar throttling.
 *
 * ───────────────────────────────────────────────────────────────
 * 🛡 Confiabilidade
 * ───────────────────────────────────────────────────────────────
 * Se o canal for ConfirmChannel:
 *   waitForConfirms() garante que o broker recebeu
 *   e persistiu a mensagem antes de continuar.
 *
 * Isso reduz risco de perda em caso de crash
 * logo após publish().
 *
 * @returns Promise<boolean>
 * true  → buffer aceitou mensagem
 * false → backpressure detectado
 *
 * @throws Pode lançar erro se:
 * - conexão estiver fechada
 * - exchange não existir
 * - serialização falhar
 */
export async function publish<T>(
  routingKey: string,
  message: Envelope<T>
): Promise<boolean> {
  const { channel } = await getRabbitConnection();

  const clientId = (message as any)?.payload?.clientId;

  log.info(
    {
      exchange: rabbitConfig.exchange,
      routingKey,
      type: message.type,
      version: message.version,
      clientId,
    },
    "Publishing message"
  );

  /**
   * Serialização para JSON.
   * Espera-se que Envelope<T> seja determinístico
   * e não contenha estruturas circulares.
   */
  const body = Buffer.from(JSON.stringify(message));

  /**
   * channel.publish retorna boolean indicando
   * se o buffer interno está disponível.
   */
  const ok = channel.publish(rabbitConfig.exchange, routingKey, body, {
    contentType: "application/json",
    deliveryMode: 2, // mensagem persistente
    timestamp: Date.now(),
  });

  /**
   * Caso o canal seja ConfirmChannel,
   * aguarda confirmação do broker.
   *
   * Isso aumenta a segurança contra perda
   * em cenários industriais críticos.
   */
  if ("waitForConfirms" in channel) {
    await (channel as any).waitForConfirms();
  }

  return ok;
}

export default { publish };
