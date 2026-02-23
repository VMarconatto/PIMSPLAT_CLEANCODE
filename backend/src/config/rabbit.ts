import { env } from './env.js'

/**
 * @file rabbit.ts
 * @description
 * Configuracao central de RabbitMQ para topologia por area (site).
 *
 * Objetivo:
 * - Normalizar nomes de area para slugs seguros.
 * - Derivar filas e routing keys por area.
 * - Expor `rabbitConfig` como contrato unico para setup/publisher/consumer.
 */

/**
 * @typedef RabbitAreaConfig
 * @description
 * Configuracao derivada de uma area/site especifica.
 *
 * @property site - Nome funcional da area (ex: "Recepcao").
 * @property slug - Nome normalizado da area (ex: "recepcao").
 * @property queue - Fila principal da area.
 * @property retryQueue - Fila de retry da area.
 * @property dlq - Fila de dead-letter final da area.
 * @property dlxExchange - Exchange DLX dedicado da area.
 * @property bindingKey - Binding principal (topic) da area.
 * @property retryRoutingKey - Routing key usada no retorno do retry para a fila principal.
 * @property dlqRoutingKey - Routing key usada no encaminhamento para a DLQ da area.
 */
export type RabbitAreaConfig = {
  site: string
  slug: string
  queue: string
  retryQueue: string
  dlq: string
  dlxExchange: string
  bindingKey: string
  retryRoutingKey: string
  dlqRoutingKey: string
  alertQueue: string
  alertRetryQueue: string
  alertDlq: string
  alertDlxExchange: string
  alertBindingKey: string
  alertRetryRoutingKey: string
  alertDlqRoutingKey: string
}

/**
 * Area padrao caso nenhuma area valida seja informada no ambiente.
 */
const DEFAULT_FALLBACK_SITE = 'Utilidades'

/**
 * Converte um nome de area para slug seguro.
 *
 * @param site - Nome original da area/site.
 * @returns Slug em lowercase, sem acentos e com underscore como separador.
 *
 * @remarks
 * Mantem padrao de nomenclatura previsivel para filas/exchanges/routing keys.
 */
export function toAreaSlug(site: string): string {
  /** Texto normalizado sem acentos e sem simbolos nao permitidos. */
  const normalized = site
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()

  return normalized || 'unknown'
}

/**
 * Faz parse de `RABBITMQ_SITES`, remove vazios e deduplica por slug.
 *
 * @param value - Lista de sites separada por virgula.
 * @returns Lista de sites valida e sem duplicidade semantica.
 */
function parseSites(value: string): string[] {
  /** Lista bruta de sites apos split/trim. */
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  /**
   * Mapa slug -> site original.
   * Garante que "Recepcao" e "Recepcao " nao virem duas areas distintas.
   */
  const unique = new Map<string, string>()
  for (const site of parsed) {
    unique.set(toAreaSlug(site), site)
  }

  if (unique.size === 0) {
    unique.set(toAreaSlug(DEFAULT_FALLBACK_SITE), DEFAULT_FALLBACK_SITE)
  }

  return Array.from(unique.values())
}

/**
 * Normaliza o prefixo base das routing keys de telemetria.
 *
 * @param prefix - Prefixo vindo do ambiente.
 * @returns Prefixo sem ponto final e com fallback para `telemetry`.
 */
function normalizePrefix(prefix: string): string {
  /** Prefixo limpo para evitar routing keys com ponto final invalido. */
  const normalized = prefix.trim().replace(/\.$/, '')
  return normalized || 'telemetry'
}

/** Prefixo de roteamento usado por producer e bindings. */
const routingPrefix = normalizePrefix(env.RABBIT_ROUTING_KEY_PREFIX)
/** Lista final de sites configurados para topologia dedicada. */
const sites = parseSites(env.RABBITMQ_SITES)

/**
 * Configuracoes por area derivadas de `sites`.
 *
 * @remarks
 * Cada area ganha sua propria fila principal, retry e DLQ.
 */
const areas: RabbitAreaConfig[] = sites.map((site) => {
  /** Slug deterministico da area atual. */
  const slug = toAreaSlug(site)
  return {
    site,
    slug,
    queue: `${env.RABBITMQ_QUEUE}.${slug}`,
    retryQueue: `${env.RABBITMQ_RETRY_QUEUE}.${slug}`,
    dlq: `${env.RABBITMQ_DLQ}.${slug}`,
    dlxExchange: `${env.RABBITMQ_EXCHANGE}.dlx.${slug}`,
    bindingKey: `${routingPrefix}.${slug}.#`,
    retryRoutingKey: `${routingPrefix}.${slug}.retry`,
    dlqRoutingKey: `${slug}.dead`,
    alertQueue: `${env.ALERTS_QUEUE}.${slug}`,
    alertRetryQueue: `${env.ALERTS_RETRY_QUEUE}.${slug}`,
    alertDlq: `${env.ALERTS_DLQ}.${slug}`,
    alertDlxExchange: `${env.RABBITMQ_EXCHANGE}.alerts.dlx.${slug}`,
    alertBindingKey: `alerts.${slug}.#`,
    alertRetryRoutingKey: `alerts.${slug}.retry`,
    alertDlqRoutingKey: `${slug}.alert.dead`,
  }
})

/** Indice de lookup rapido por slug da area. */
const areasBySlug = new Map(areas.map((area) => [area.slug, area]))
/** Area padrao para fallback quando `site` nao bater com nenhuma area declarada. */
const defaultArea = areas[0]
/**
 * Alias de slugs conhecidos para evitar fallback indevido quando
 * o payload chega com variacao de nomenclatura.
 */
const siteSlugAliases = new Map<string, string>([
  ['recebimento_de_leite_cru', 'recepcao'],
  ['despacho_de_creme', 'expedicao_de_creme'],
  ['estocagem_de_pasteurizado', 'pasteurizacao'],
])

function resolveSiteSlug(site: string): string {
  const slug = toAreaSlug(site)
  return siteSlugAliases.get(slug) ?? slug
}

/**
 * Resolve a configuracao de area usando o valor de `site`.
 *
 * @param site - Valor recebido no payload/producer.
 * @returns Configuracao da area correspondente; fallback para primeira area configurada.
 */
export function resolveAreaBySite(site: string): RabbitAreaConfig {
  return areasBySlug.get(resolveSiteSlug(site)) ?? defaultArea
}

/**
 * Contrato final consumido pelos modulos de infraestrutura RabbitMQ.
 *
 * @remarks
 * Campos legados (`queue`, `dlq`, `retryQueue`) continuam expostos para compatibilidade,
 * apontando para a area default.
 */
export const rabbitConfig = {
  /** URL AMQP/AMQPS do broker. */
  url: env.RABBITMQ_URL,
  /** VHost do RabbitMQ. */
  vhost: env.RABBITMQ_VHOST,
  /** Heartbeat AMQP em segundos. */
  heartbeat: env.RABBITMQ_HEARTBEAT,
  /** Prefetch global do consumer. */
  prefetch: env.RABBITMQ_PREFETCH,
  /** Exchange principal de telemetria. */
  exchange: env.RABBITMQ_EXCHANGE,
  /** Tipo do exchange principal (topic/direct/etc). */
  exchangeType: env.RABBITMQ_EXCHANGE_TYPE,
  /** Fila default (area padrao) para compatibilidade. */
  queue: defaultArea.queue,
  /** Binding global de telemetria por prefixo. */
  routingKey: `${routingPrefix}.#`,
  /** DLQ default (area padrao) para compatibilidade. */
  dlq: defaultArea.dlq,
  /** Retry queue default (area padrao) para compatibilidade. */
  retryQueue: defaultArea.retryQueue,
  /** TTL de retry em milissegundos. */
  retryTtlMs: env.RABBITMQ_RETRY_TTL_MS,
  /** Se true, publisher usa confirm channel. */
  publishConfirm: env.RABBITMQ_PUBLISH_CONFIRM,
  /** Prefixo base das routing keys de telemetria. */
  routingPrefix,
  /** Lista nominal dos sites configurados. */
  sites,
  /** Configuracao completa de topologia por area. */
  areas,
  /** Configuracao TLS opcional da conexao RabbitMQ. */
  tls: {
    enabled: env.RABBITMQ_TLS_ENABLED,
    caPath: env.RABBITMQ_CA_PATH,
    certPath: env.RABBITMQ_CERT_PATH,
    keyPath: env.RABBITMQ_KEY_PATH,
  },
}
