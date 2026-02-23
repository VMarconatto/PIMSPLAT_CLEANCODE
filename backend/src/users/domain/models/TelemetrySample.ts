/* eslint-disable prettier/prettier */

/**
 * @file TelemetrySample.ts
 * @description
 * Entidade de domínio que representa uma amostra de telemetria industrial.
 *
 * Contexto:
 * - Cada amostra corresponde a um ciclo de leitura do OPC UA client.
 * - Os dados são coletados, publicados no RabbitMQ e persistidos no PostgreSQL.
 * - Cada client (clientName) possui sua própria tabela no banco.
 *
 * Em Clean Architecture:
 * - Este model pertence à camada **Domain** — é o núcleo da regra de negócio.
 * - Não depende de ORM, framework HTTP, ou banco de dados.
 * - O repositório (Infrastructure) converte entre esta entidade e o schema do banco.
 * - Os DTOs (Application) convertem entre esta entidade e o formato de saída.
 */

import type { EnrichedTagValue } from '../../../messaging/types.js'

export type TagValue = EnrichedTagValue

export type TelemetrySampleProps = {
  id: string
  clientName: string
  timestamp: Date
  tags: Record<string, TagValue>
  site: string
  line: string
  hostId: string
}

export class TelemetrySample {
  /**
   * Identificador único da amostra (msgId/UUID).
   * Usado para garantir idempotência no consumer do RabbitMQ.
   */
  public readonly id: string

  /**
   * Nome do OpcuaClient que coletou os dados (ex: "Device01").
   * Identifica a tabela dedicada no PostgreSQL.
   */
  public readonly clientName: string

  /**
   * Timestamp da leitura OPC UA.
   */
  public readonly timestamp: Date

  /**
   * Valores das tags lidos do OPC UA.
   * Chave: nome da tag (ex: "Tag_01", "Pressure_PT01").
   * Valor: dado lido (numérico, string ou booleano).
   */
  public readonly tags: Record<string, TagValue>

  /**
   * Identificador da planta/site industrial.
   */
  public readonly site: string

  /**
   * Linha de produção.
   */
  public readonly line: string

  /**
   * Identificador do host físico que executou a coleta.
   */
  public readonly hostId: string

  constructor(props: TelemetrySampleProps) {
    this.id = props.id
    this.clientName = props.clientName
    this.timestamp = props.timestamp
    this.tags = props.tags
    this.site = props.site
    this.line = props.line
    this.hostId = props.hostId
  }

  /**
   * Retorna os nomes de todas as tags presentes nesta amostra.
   */
  getTagNames(): string[] {
    return Object.keys(this.tags)
  }

  /**
   * Retorna o valor de uma tag específica, ou undefined se não existir.
   */
  getTagValue(tagName: string): TagValue | undefined {
    return this.tags[tagName]
  }

  /**
   * Retorna apenas as tags com valor numérico (útil para cálculos, alertas, gráficos).
   */
  getNumericTags(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [key, tag] of Object.entries(this.tags)) {
      if (typeof tag.value === 'number') {
        result[key] = tag.value
      }
    }
    return result
  }

  /**
   * Converte a entidade para um objeto plano (útil para serialização/DTO).
   */
  toJSON(): TelemetrySampleProps {
    return {
      id: this.id,
      clientName: this.clientName,
      timestamp: this.timestamp,
      tags: { ...this.tags },
      site: this.site,
      line: this.line,
      hostId: this.hostId,
    }
  }
}
