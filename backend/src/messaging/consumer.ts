import { ConsumeMessage } from 'amqplib'
import { rabbitConfig, type RabbitAreaConfig } from '../config/rabbit.js'
import { getRabbitConnection } from './rabbitmq.connection.js'
import { sendToRetryQueue } from './retry.js'
import pino from 'pino'
import 'reflect-metadata'
import { container } from 'tsyringe'
import type { AlertMessage, Envelope, TelemetryMessage } from './types.js'
import { AppError } from '../common/domain/errors/app-error.js'
import { BadRequestError } from '../common/domain/errors/bad-request-error.js'
import { dataSource } from '../common/infrastructure/typeorm/index.js'
import type { ReadCycleUseCase } from '../telemetry/app/usecases/read-cycle.usecase.js'
import type { ProcessAlertsUseCase } from '../alerts/app/usecases/processAlerts.usecase.js'
import '../telemetry/infrastructure/container/index.js'
import '../alerts/infrastructure/container/index.js'

/**
 * @file consumer.ts
 * @description
 * Consumer RabbitMQ com suporte a:
 * - consumo por multiplas filas (uma por area/site)
 * - parse e validacao de envelope
 * - integracao com caso de uso de persistencia
 * - retry com TTL e DLQ por area
 */

/** Logger do worker de consumo. */
const log = pino({ name: 'consumer' })

/**
 * Assinatura do handler de regra de negocio.
 *
 * @param msg - Mensagem parseada (ainda sem tipo estrito).
 * @returns Promise<void>
 *
 * @remarks
 * `unknown` e intencional para forcar validacao explicita no handler.
 */
type Handler = (msg: unknown) => Promise<void>

/**
 * Type guard basico para objetos JS nao nulos.
 *
 * @param value - Valor a ser testado.
 * @returns `true` quando `value` e objeto nao nulo.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Valida e converte o payload bruto em `Envelope<TelemetryMessage>`.
 *
 * @param msg - Payload parseado do JSON consumido.
 * @returns Envelope de telemetria validado estruturalmente.
 * @throws BadRequestError quando o contrato minimo do envelope e invalido.
 */
function parseTelemetryEnvelope(msg: unknown): Envelope<TelemetryMessage> {
  if (!isObject(msg)) {
    throw new BadRequestError('Invalid telemetry envelope: expected object')
  }

  if (typeof msg.type !== 'string') {
    throw new BadRequestError('Invalid telemetry envelope: "type" must be string')
  }

  if (typeof msg.version !== 'number') {
    throw new BadRequestError('Invalid telemetry envelope: "version" must be number')
  }

  if (!isObject(msg.payload)) {
    throw new BadRequestError('Invalid telemetry envelope: "payload" must be object')
  }

  return msg as Envelope<TelemetryMessage>
}

/**
 * Inicializa o worker completo de telemetria:
 * - DataSource
 * - resolucao do ReadCycleUseCase
 * - consumo RabbitMQ
 *
 * @param areaSlug - Slug da area a consumir (ex: "pasteurizacao").
 *                   Quando informado, consome apenas a fila daquela area.
 *                   Quando omitido, consome todas as filas (comportamento legado).
 * @returns Promise<void>
 *
 * @remarks
 * Este e o entrypoint recomendado para pipeline
 * RabbitMQ -> UseCase -> TypeORM/Postgres.
 */
export async function startTelemetryConsumer(areaSlug?: string): Promise<void> {
  log.info('[startTelemetryConsumer] Iniciando...')

  if (!dataSource.isInitialized) {
    log.info('[startTelemetryConsumer] DataSource nao inicializado, inicializando...')
    await dataSource.initialize()
    log.info('[startTelemetryConsumer] DataSource inicializado com sucesso')
  }

  log.info('[startTelemetryConsumer] Resolvendo ReadCycleUseCase do container...')
  const readCycleUseCase = container.resolve<ReadCycleUseCase>('ReadCycleUseCase')
  log.info('[startTelemetryConsumer] ReadCycleUseCase resolvido com sucesso')

  await startConsumer(async (msg) => {
    /** Envelope validado recebido da fila. */
    const envelope = parseTelemetryEnvelope(msg)
    /** DTO persistido retornado pelo use case apos insert no banco. */
    const persisted = await readCycleUseCase.execute(envelope.payload)

    log.info(
      {
        clientId: persisted.clientName,
        msgId: persisted.id,
        ts: persisted.timestamp,
      },
      'Telemetry persisted in PostgreSQL',
    )
  }, areaSlug)
}

/**
 * Valida e converte o payload bruto em `Envelope<AlertMessage>`.
 */
function parseAlertEnvelope(msg: unknown): Envelope<AlertMessage> {
  if (!isObject(msg)) {
    throw new BadRequestError('Invalid alert envelope: expected object')
  }

  if (typeof msg.type !== 'string') {
    throw new BadRequestError('Invalid alert envelope: "type" must be string')
  }

  if (typeof msg.version !== 'number') {
    throw new BadRequestError('Invalid alert envelope: "version" must be number')
  }

  if (!isObject(msg.payload)) {
    throw new BadRequestError('Invalid alert envelope: "payload" must be object')
  }

  return msg as Envelope<AlertMessage>
}

/**
 * Inicializa o worker completo de alertas:
 * - DataSource
 * - resolucao do ProcessAlertsUseCase
 * - consumo RabbitMQ das filas de alerta
 */
export async function startAlertConsumer(areaSlug?: string): Promise<void> {
  log.info('[startAlertConsumer] Iniciando...')

  if (!dataSource.isInitialized) {
    log.info('[startAlertConsumer] DataSource nao inicializado, inicializando...')
    await dataSource.initialize()
    log.info('[startAlertConsumer] DataSource inicializado com sucesso')
  }

  log.info('[startAlertConsumer] Resolvendo ProcessAlertsUseCase do container...')
  const processAlertsUseCase = container.resolve<ProcessAlertsUseCase>('ProcessAlertsUseCase')
  log.info('[startAlertConsumer] ProcessAlertsUseCase resolvido com sucesso')

  log.info('[startAlertConsumer] Registrando consumer nas filas de alerta...')
  await startAlertQueueConsumer(async (msg) => {
    const envelope = parseAlertEnvelope(msg)
    const payload = envelope.payload

    const result = await processAlertsUseCase.execute({
      clientId: payload.clientId,
      site: payload.site,
      tagName: payload.tagName,
      value: payload.value,
      desvio: payload.desvio,
      alertsCount: payload.alertsCount,
      unidade: payload.unidade,
      recipients: payload.recipients,
      timestamp: payload.ts,
      dedupWindowMs: payload.dedupWindowMs,
    })

    console.log('[ALERT][PERSISTED]', {
      clientId: payload.clientId,
      tagName: payload.tagName,
      desvio: payload.desvio,
      saved: result.saved,
    })

    log.info(
      {
        clientId: payload.clientId,
        tagName: payload.tagName,
        desvio: payload.desvio,
        saved: result.saved,
      },
      'Alert processed from RabbitMQ',
    )
  }, areaSlug)
}

/**
 * Inicializa consumo AMQP para filas de alerta por area.
 */
async function startAlertQueueConsumer(handler: Handler, areaSlug?: string): Promise<void> {
  const { channel } = await getRabbitConnection()

  await channel.prefetch(rabbitConfig.prefetch)

  const areas = areaSlug
    ? rabbitConfig.areas.filter((a) => a.slug === areaSlug)
    : rabbitConfig.areas

  if (areas.length === 0) {
    throw new Error(`Area slug "${areaSlug}" not found in rabbitConfig.areas`)
  }

  for (const area of areas) {
    await channel.consume(
      area.alertQueue,
      async (m) => {
        if (!m) return
        await handleAlertMessage(channel, m, handler, area)
      },
      { noAck: false },
    )
  }

  log.info(
    {
      prefetch: rabbitConfig.prefetch,
      areaSlug: areaSlug ?? 'all',
      queues: areas.map((area) => area.alertQueue),
    },
    'Alert consumer started',
  )
}

/**
 * Processa mensagem AMQP de alerta com estrategia de ack/retry/DLQ.
 */
async function handleAlertMessage(
  channel: any,
  m: ConsumeMessage,
  handler: Handler,
  area: RabbitAreaConfig,
): Promise<void> {
  const raw = m.content
  const headers = m.properties.headers ?? {}
  const retryCount = Number(headers['x-retry'] ?? 0)

  try {
    const parsed = JSON.parse(raw.toString('utf-8'))

    log.info(
      {
        queue: area.alertQueue,
        site: area.site,
        retryCount,
        msgType: parsed?.type,
        version: parsed?.version,
        clientId: parsed?.payload?.clientId,
      },
      'Consumed alert message',
    )

    console.log('[RABBIT][ALERT][CONSUMED]', JSON.stringify(parsed, null, 2))
    await handler(parsed)

    channel.ack(m)
  } catch (err) {
    const isParseError = err instanceof SyntaxError
    const appError = err instanceof AppError ? err : undefined
    const retryable = isParseError ? false : appError?.retryable ?? true

    log.error(
      {
        err,
        retryCount,
        retryable,
        category: appError?.category,
        queue: area.alertQueue,
        site: area.site,
      },
      'Alert message processing failed',
    )

    const MAX_RETRIES = 5

    if (retryable && retryCount < MAX_RETRIES) {
      channel.ack(m)
      await sendToRetryQueue(raw, headers, area.alertRetryQueue)
    } else {
      channel.nack(m, false, false)
    }
  }
}

/**
 * Inicializa consumo AMQP para filas de area configuradas.
 *
 * @param handler - Funcao de negocio executada por mensagem consumida.
 * @param areaSlug - Slug da area a consumir (ex: "pasteurizacao").
 *                   Quando informado, consome apenas a fila daquela area.
 *                   Quando omitido, consome todas as filas (comportamento legado).
 * @returns Promise<void>
 *
 * @remarks
 * O metodo configura `prefetch` uma vez no canal
 * e registra um `consume` por queue de area.
 */
export async function startConsumer(handler: Handler, areaSlug?: string): Promise<void> {
  /** Canal AMQP compartilhado para consumo concorrente por area. */
  const { channel } = await getRabbitConnection()

  await channel.prefetch(rabbitConfig.prefetch)

  /**
   * Resolve as areas a consumir.
   * Se `areaSlug` for informado, filtra apenas a area correspondente.
   * Caso contrario, consome todas as areas configuradas.
   */
  const areas = areaSlug
    ? rabbitConfig.areas.filter((a) => a.slug === areaSlug)
    : rabbitConfig.areas

  if (areas.length === 0) {
    throw new Error(`Area slug "${areaSlug}" not found in rabbitConfig.areas`)
  }

  for (const area of areas) {
    await channel.consume(
      area.queue,
      async (m) => {
        if (!m) return
        await handleMessage(channel, m, handler, area)
      },
      { noAck: false },
    )
  }

  log.info(
    {
      prefetch: rabbitConfig.prefetch,
      areaSlug: areaSlug ?? 'all',
      queues: areas.map((area) => area.queue),
    },
    'Consumer started',
  )
}

/**
 * Processa uma mensagem AMQP com estrategia de ack/retry/DLQ.
 *
 * @param channel - Canal AMQP usado para ack/nack/publicacao de retry.
 * @param m - Mensagem consumida do RabbitMQ.
 * @param handler - Handler de negocio injetado.
 * @param area - Metadados da area/fila de origem da mensagem.
 * @returns Promise<void>
 *
 * @remarks
 * Politica:
 * - sucesso -> ack
 * - erro retryable com retry disponivel -> ack + envia para retry queue da area
 * - erro nao retryable ou limite excedido -> nack sem requeue (vai para DLQ)
 */
async function handleMessage(
  channel: any,
  m: ConsumeMessage,
  handler: Handler,
  area: RabbitAreaConfig,
): Promise<void> {
  /** Conteudo bruto da mensagem para parse e possivel reenfileiramento em retry. */
  const raw = m.content
  /** Headers AMQP originais (incluindo possivel x-retry). */
  const headers = m.properties.headers ?? {}
  /** Numero da tentativa atual de processamento. */
  const retryCount = Number(headers['x-retry'] ?? 0)

  try {
    /** Payload parseado do corpo JSON consumido. */
    const parsed = JSON.parse(raw.toString('utf-8'))

    log.info(
      {
        queue: area.queue,
        site: area.site,
        retryCount,
        msgType: parsed?.type,
        version: parsed?.version,
        clientId: parsed?.payload?.clientId,
        ts: parsed?.payload?.ts,
      },
      'Consumed message',
    )

    console.log('[RABBIT][CONSUMED]', JSON.stringify(parsed, null, 2))
    await handler(parsed)

    if (retryCount > 0) {
      console.log('[RABBIT][RETRY][RECOVERED]', {
        retryCount,
        msgId: parsed?.payload?.msgId,
        clientId: parsed?.payload?.clientId,
        ts: parsed?.payload?.ts,
      })
    }

    channel.ack(m)
  } catch (err) {
    /** Parse invalido nunca deve ser reenfileirado. */
    const isParseError = err instanceof SyntaxError
    /** Erro de dominio/aplicacao com metadata retryable/categoria. */
    const appError = err instanceof AppError ? err : undefined
    /** Decisao final de retentativa para este erro. */
    const retryable = isParseError ? false : appError?.retryable ?? true

    log.error(
      {
        err,
        retryCount,
        retryable,
        category: appError?.category,
        queue: area.queue,
        site: area.site,
      },
      'Message processing failed',
    )

    /** Limite maximo local de retentativas antes de DLQ. */
    const MAX_RETRIES = 5

    if (retryable && retryCount < MAX_RETRIES) {
      console.log('[RABBIT][RETRY][ENQUEUED]', {
        site: area.site,
        currentRetry: retryCount,
        nextRetry: retryCount + 1,
        retryQueue: area.retryQueue,
      })

      channel.ack(m)
      await sendToRetryQueue(raw, headers, area.retryQueue)
    } else {
      channel.nack(m, false, false)
    }
  }
}
