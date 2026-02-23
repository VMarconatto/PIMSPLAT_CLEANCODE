import { rabbitConfig } from "../config/rabbit.js";
import { getRabbitConnection } from "./rabbitmq.connection.js";
import pino from "pino";

/**
 * @file rabbitmq.setup.ts
 * @description
 * Bootstrap da topologia RabbitMQ para telemetria segmentada por area.
 *
 * Topologia por area:
 * - Exchange principal (topic): recebe publish de telemetria.
 * - Queue principal por area: consumo normal.
 * - Retry queue por area: atraso por TTL e retorno ao exchange principal.
 * - DLX por area: roteia falhas definitivas da queue principal.
 * - DLQ por area: destino final de mensagens mortas.
 */

/** Logger estruturado para diagnostico de topologia. */
const log = pino({ name: "rabbitmq-setup" });

/**
 * Cria/valida idempotentemente toda a topologia RabbitMQ.
 *
 * @returns Promise<void>
 *
 * @remarks
 * Esta funcao pode rodar em todo boot do servico.
 * `assertExchange`/`assertQueue` sao idempotentes quando a configuracao e compativel.
 *
 * Ordem executada:
 * 1. Exchange principal.
 * 2. Para cada area: DLX, DLQ, retryQueue, queue principal, bindings.
 */
export async function setupRabbitTopology(): Promise<void> {
  /** Conexao e canal AMQP reutilizaveis para setup da topologia. */
  const { channel } = await getRabbitConnection();

  /**
   * Exchange principal de telemetria (topic).
   *
   * Compartilhado por todas as areas — todo publish de telemetria entra por aqui.
   * Routing keys seguem o padrao `<prefix>.<slug>.<sufixo>`, permitindo bindings
   * com wildcard `#` por area.
   *
   * @see rabbitConfig.exchange — nome configuravel via env `RABBITMQ_EXCHANGE`.
   * @see rabbitConfig.exchangeType — tipo configuravel (default: "topic").
   *
   * Corresponde ao exchange `telemetry.exchange` visivel no Management UI.
   */
  await channel.assertExchange(rabbitConfig.exchange, rabbitConfig.exchangeType, {
    durable: true,
  });

  for (const area of rabbitConfig.areas) {
    /**
     * Exchange DLX (Dead Letter Exchange) dedicado da area.
     *
     * Cada area recebe seu proprio DLX do tipo `direct`.
     * Quando a queue principal da area faz `nack` com `requeue: false`
     * (falha definitiva apos esgotamento de retries), a mensagem e
     * encaminhada automaticamente para este DLX via argumento
     * `x-dead-letter-exchange` da queue principal (configurado mais abaixo).
     *
     * Nomenclatura: `telemetry.exchange.dlx.<slug>`
     * Exemplo: `telemetry.exchange.dlx.recepcao`
     *
     * No Management UI, esses exchanges aparecem como:
     *   - telemetry.exchange.dlx.alsafe
     *   - telemetry.exchange.dlx.estocagem_de_leite_cru
     *   - telemetry.exchange.dlx.expedicao_de_creme
     *   - telemetry.exchange.dlx.pasteurizacao
     *   - telemetry.exchange.dlx.recepcao
     *   - telemetry.exchange.dlx.utilidades
     *
     * @see area.dlxExchange — nome derivado em `rabbit.ts` como `${exchange}.dlx.${slug}`.
     */
    await channel.assertExchange(area.dlxExchange, "direct", { durable: true });

    /**
     * DLQ (Dead Letter Queue) final da area.
     *
     * Destino definitivo das mensagens que falharam alem do limite de retries.
     * Vinculada ao DLX da area via routing key `<slug>.dead`.
     *
     * Mensagens aqui podem ser inspecionadas manualmente ou reprocessadas
     * por ferramentas externas — nenhum consumer automatico consome esta fila.
     */
    await channel.assertQueue(area.dlq, { durable: true });

    /**
     * Binding: DLX da area -> DLQ da area.
     *
     * Routing key: `<slug>.dead` (ex: `recepcao.dead`).
     * Garante que mensagens mortas da queue principal cheguem a DLQ correta.
     */
    await channel.bindQueue(area.dlq, area.dlxExchange, area.dlqRoutingKey);

    /**
     * Retry queue da area (delayed redelivery).
     *
     * Funciona como "sala de espera" temporaria para mensagens que falharam
     * mas ainda tem tentativas restantes.
     *
     * Mecanismo:
     * 1. Consumer faz `nack` e republica a mensagem nesta fila.
     * 2. A mensagem aguarda aqui pelo tempo definido em `x-message-ttl`.
     * 3. Ao expirar o TTL, o RabbitMQ encaminha automaticamente a mensagem
     *    de volta ao exchange principal (`telemetry.exchange`) usando
     *    `x-dead-letter-routing-key` = `<prefix>.<slug>.retry`.
     * 4. O binding de retry na queue principal captura e reprocessa.
     *
     * @see rabbitConfig.retryTtlMs — tempo de espera antes do reenvio (ms).
     */
    await channel.assertQueue(area.retryQueue, {
      durable: true,
      arguments: {
        "x-message-ttl": rabbitConfig.retryTtlMs,
        "x-dead-letter-exchange": rabbitConfig.exchange,
        "x-dead-letter-routing-key": area.retryRoutingKey,
      },
    });

    /**
     * Queue principal da area — onde o consumer de telemetria processa mensagens.
     *
     * Configurada com `x-dead-letter-exchange` apontando para o DLX dedicado
     * da area. Quando o consumer executa `nack(msg, false, false)` (requeue=false),
     * o RabbitMQ roteia automaticamente a mensagem para o DLX, que por sua vez
     * entrega na DLQ da area.
     *
     * Fluxo de falha definitiva:
     *   queue principal -> DLX da area -> DLQ da area
     *
     * @see area.dlxExchange — exchange DLX configurado acima neste mesmo loop.
     * @see area.dlqRoutingKey — routing key usada no encaminhamento para a DLQ.
     */
    await channel.assertQueue(area.queue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": area.dlxExchange,
        "x-dead-letter-routing-key": area.dlqRoutingKey,
      },
    });

    /**
     * Binding principal — telemetria normal.
     *
     * Captura mensagens publicadas com routing key `<prefix>.<slug>.#`
     * no exchange principal e direciona para a queue da area.
     */
    await channel.bindQueue(area.queue, rabbitConfig.exchange, area.bindingKey);

    /**
     * Binding de retorno do retry.
     *
     * Captura mensagens devolvidas pela retry queue (apos expirar o TTL)
     * com routing key `<prefix>.<slug>.retry` e reentrega na queue principal
     * para reprocessamento.
     */
    await channel.bindQueue(area.queue, rabbitConfig.exchange, area.retryRoutingKey);
  }

  // ─── Topologia de Alerts por area ───
  for (const area of rabbitConfig.areas) {
    await channel.assertExchange(area.alertDlxExchange, "direct", { durable: true });

    await channel.assertQueue(area.alertDlq, { durable: true });
    await channel.bindQueue(area.alertDlq, area.alertDlxExchange, area.alertDlqRoutingKey);

    await channel.assertQueue(area.alertRetryQueue, {
      durable: true,
      arguments: {
        "x-message-ttl": rabbitConfig.retryTtlMs,
        "x-dead-letter-exchange": rabbitConfig.exchange,
        "x-dead-letter-routing-key": area.alertRetryRoutingKey,
      },
    });

    await channel.assertQueue(area.alertQueue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": area.alertDlxExchange,
        "x-dead-letter-routing-key": area.alertDlqRoutingKey,
      },
    });

    await channel.bindQueue(area.alertQueue, rabbitConfig.exchange, area.alertBindingKey);
    await channel.bindQueue(area.alertQueue, rabbitConfig.exchange, area.alertRetryRoutingKey);
  }

  log.info(
    {
      exchange: rabbitConfig.exchange,
      retryTtlMs: rabbitConfig.retryTtlMs,
      areas: rabbitConfig.areas.map((area) => ({
        site: area.site,
        queue: area.queue,
        retryQueue: area.retryQueue,
        dlxExchange: area.dlxExchange,
        dlq: area.dlq,
        bindingKey: area.bindingKey,
        alertQueue: area.alertQueue,
        alertRetryQueue: area.alertRetryQueue,
        alertDlq: area.alertDlq,
        alertBindingKey: area.alertBindingKey,
      })),
    },
    "RabbitMQ topology ready (telemetry + alerts)",
  );
}
