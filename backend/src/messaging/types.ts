/**
 * @file types.ts
 * @description
 * Define o contrato das mensagens trafegadas via RabbitMQ.
 * Esse contrato é o “ponto de acoplamento” entre:
 * - produtores (ex: coletor OPC UA)
 * - consumidores (ex: gravação no Postgres, alertas, analytics)
 *
 * ✅ Onde entra OPC UA aqui?
 * - Aqui é onde você define como o dado OPC UA vira uma estrutura serializável.
 * - `tags` normalmente vira um objeto { tagName: value } vindo do OPC UA.
 */

/**
 * @type TelemetryMessage
 * @description
 * Payload típico industrial de telemetria.
 *
 * Campos principais:
 * - msgId: usado para idempotência no consumer (evitar duplicar inserts)
 * - ts: timestamp ISO do momento da leitura (ou do sample)
 * - site/line/hostId: rastreabilidade no chão de fábrica
 * - clientId: identifica o “cliente/linha/asset” (ex: Client01)
 * - tags: valores lidos (OPC UA → tags)
 */
/**
 * Propriedades enriquecidas de um tag OPC UA.
 * Inclui valor, metadados de identificação e timestamps.
 */
export type EnrichedTagValue = {
  value: number | string | boolean | null
  browseName: string
  displayName: string
  description: string
  dataType: string
  statusCode: string
  sourceTimestamp: string | null
  serverTimestamp: string | null
  minValue: number | null
  maxValue: number | null
}

export type TelemetryMessage = {
  msgId: string
  ts: string // ISO
  site: string
  line: string
  hostId: string
  clientId: string // ex: Client01
  tags: Record<string, EnrichedTagValue>
}

/**
 * @type AlertMessage
 * @description
 * Payload de alerta industrial publicado no RabbitMQ.
 *
 * Segue o mesmo padrão do TelemetryMessage:
 * - msgId: UUID para idempotência no consumer
 * - ts: timestamp ISO do momento da detecção
 * - clientId: identifica o cliente/asset de origem
 * - tagName, value, desvio: dados do alerta detectado
 * - recipients: destinatários de notificação
 */
export type AlertMessage = {
  msgId: string
  ts: string
  site?: string
  clientId: string
  tagName: string
  value: number
  desvio: 'LL' | 'L' | 'H' | 'HH'
  alertsCount: number
  unidade: string
  recipients: string[]
  dedupWindowMs?: number
}

/**
 * @type Envelope
 * @description
 * Envelope genérico para versionamento e roteamento por tipo.
 * Ajuda a evoluir contratos sem quebrar consumers:
 * - type: define o tipo lógico do evento
 * - version: permite evolução gradual do schema
 * - payload: conteúdo do evento (ex: TelemetryMessage)
 */
export type Envelope<T> = {
  type: string
  version: number
  payload: T
}
