import 'dotenv/config'
import { z } from 'zod'

/**
 * @file env.ts
 * @description
 * Centraliza a leitura e validação das variáveis de ambiente da aplicação.
 *
 * Por que isso é importante em ambiente industrial/container?
 * - Evita “rodar com env faltando” e descobrir só em produção.
 * - Padroniza defaults (heartbeat, prefetch, exchange, etc).
 * - Garante tipos corretos (string → number, string → boolean).
 *
 * ✅ Onde entra OPC UA aqui?
 * - Não entra dado OPC UA.
 * - No máximo, você adicionaria variáveis de ambiente relacionadas ao OPC UA
 *   (endpoint, securityPolicy, nodes, intervalo de leitura, etc), mas NÃO os valores lidos.
 */

/**
 * @description
 * Schema Zod que define o contrato das variáveis de ambiente esperadas pela aplicação.
 * - `.default(...)` define fallback seguro.
 * - `z.coerce` converte string do process.env para number/boolean.
 */
const EnvSchema = z.object({
  /** @description Nome lógico do container/processo (aparece nos logs). */
  APP_NAME: z.string().default('app'),

  /** @description Identificação do site/planta (útil para rastreabilidade das mensagens). */
  SITE: z.string().default('SITE'),

  /** @description Identificação da linha/célula de produção. */
  LINE: z.string().default('LINE'),

  /** @description Identificador do host físico onde o container está rodando. */
  HOST_ID: z.string().default('HOST'),

  /** @description URL AMQP do RabbitMQ (amqp:// ou amqps://). */
  RABBITMQ_URL: z.string(),

  /** @description Virtual host do RabbitMQ. */
  RABBITMQ_VHOST: z.string().default('/'),

  /** @description Heartbeat AMQP (segundos): mantém conexão viva e detecta quedas. */
  RABBITMQ_HEARTBEAT: z.coerce.number().int().positive().default(30),

  /** @description Prefetch: limita quantas mensagens o consumer pega antes de dar ack. */
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(50),

  /** @description Exchange principal onde as mensagens serão publicadas. */
  RABBITMQ_EXCHANGE: z.string().default('telemetry.x'),

  /** @description Tipo do exchange: topic é comum para roteamento por chaves (routing keys). */
  RABBITMQ_EXCHANGE_TYPE: z.enum(['direct', 'topic', 'fanout', 'headers']).default('topic'),

  /** @description Nome da fila principal (consumer). */
  RABBITMQ_QUEUE: z.string().default('telemetry.q'),

  /** @description Routing key (binding) que conecta exchange → fila. */
  RABBITMQ_ROUTING_KEY: z.string().default('telemetry.*'),

  /** @description Prefixo base das routing keys de telemetria publicadas pelos producers. */
  RABBIT_ROUTING_KEY_PREFIX: z.string().default('telemetry'),

  /** @description Dead-letter queue: destino final de mensagens “mortas” (falhas repetidas). */
  RABBITMQ_DLQ: z.string().default('telemetry.dlq'),

  /** @description Fila de retry (retentativas com delay via TTL). */
  RABBITMQ_RETRY_QUEUE: z.string().default('telemetry.retry'),

  /** @description TTL do retry (ms): quanto tempo a msg fica “parada” antes de voltar. */
  RABBITMQ_RETRY_TTL_MS: z.coerce.number().int().positive().default(15000),

  /** @description Lista de áreas/sites para topologia dedicada, separadas por vírgula. */
  RABBITMQ_SITES: z.string().default(
    'Utilidades,Recepção,Estocagem de Leite Cru,Expedição de Creme,Pasteurização,Alsafe',
  ),

  /** @description Se true, usa ConfirmChannel (publisher confirms). */
  RABBITMQ_PUBLISH_CONFIRM: z.coerce.boolean().default(true),

  /** @description Flag para TLS (amqps). */
  RABBITMQ_TLS_ENABLED: z.coerce.boolean().default(false),

  /** @description Caminho do CA (certificado da autoridade) para validar o servidor. */
  RABBITMQ_CA_PATH: z.string().optional(),

  /** @description Caminho do cert do cliente (mTLS), se aplicável. */
  RABBITMQ_CERT_PATH: z.string().optional(),

  /** @description Caminho da chave privada do cliente (mTLS), se aplicável. */
  RABBITMQ_KEY_PATH: z.string().optional(),

  /** @description Nome base da fila principal de alertas. */
  ALERTS_QUEUE: z.string().default('alerts.queue'),

  /** @description Nome base da fila de retry de alertas. */
  ALERTS_RETRY_QUEUE: z.string().default('alerts.retry'),

  /** @description Nome base da dead-letter queue de alertas. */
  ALERTS_DLQ: z.string().default('alerts.dlq'),
})

/**
 * @description
 * Objeto final de configuração já validado e tipado.
 * Se faltar variável obrigatória ou tiver tipo inválido, a app falha cedo (fail fast).
 */
export const env = EnvSchema.parse(process.env)
