import { getRabbitConnection } from './rabbitmq.connection.js'

/**
 * @file retry.ts
 * @description
 * Encaminhamento de mensagens para fila de retry dedicada por area.
 *
 * Estrategia:
 * - Consumer detecta erro retryable.
 * - Mensagem original e reenviada para retryQueue da area.
 * - Header `x-retry` e incrementado.
 * - Topologia Rabbit (TTL + dead-letter) devolve depois para o exchange principal.
 */

/**
 * Reencaminha mensagem para retry queue dedicada.
 *
 * @param rawBody - Corpo original da mensagem AMQP.
 * @param headers - Headers AMQP existentes da mensagem original.
 * @param retryQueue - Nome da retry queue da area/site da mensagem.
 * @returns Promise<void>
 *
 * @remarks
 * O metodo nao altera o payload; apenas incrementa `x-retry`.
 * `deliveryMode: 2` marca a mensagem como persistente.
 */
export async function sendToRetryQueue(
  rawBody: Buffer,
  headers: Record<string, any> = {},
  retryQueue: string,
): Promise<void> {
  /** Canal AMQP usado para publicar na retry queue. */
  const { channel } = await getRabbitConnection()

  /** Novo contador de retentativas para observabilidade e politicas futuras. */
  const nextRetry = (headers['x-retry'] ?? 0) + 1

  channel.sendToQueue(retryQueue, rawBody, {
    contentType: 'application/json',
    deliveryMode: 2,
    headers: {
      ...headers,
      'x-retry': nextRetry,
    },
  })

  if ('waitForConfirms' in channel) {
    await channel.waitForConfirms()
  }
}
