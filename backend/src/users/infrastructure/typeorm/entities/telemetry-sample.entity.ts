/* eslint-disable prettier/prettier */

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm'
import type { EnrichedTagValue } from '../../../../messaging/types.js'

/**
 * @file telemetry-sample.entity.ts
 * @description
 * Entidade TypeORM que representa uma amostra de telemetria persistida no PostgreSQL.
 *
 * Contexto:
 * - Cada OpcuaClient possui sua própria tabela no banco (criada dinamicamente via ensureTable).
 * - Esta entidade define o **schema base** que todas as tabelas de telemetria seguem.
 * - O nome da tabela é dinâmico (definido pelo clientName), por isso usamos
 *   um placeholder 'telemetry_samples' no decorator @Entity.
 *   Na prática, as queries usam queryRunner/queryBuilder com o nome real da tabela.
 *
 * Papel na Clean Architecture:
 * - Pertence à camada **infrastructure** — detalhe de persistência.
 * - O domínio (TelemetrySample) não conhece esta classe.
 * - O repositório concreto converte entre esta entidade e o model de domínio.
 */

@Entity('telemetry_samples')
export class TelemetrySampleEntity {
  /**
   * Identificador único da amostra (msgId do RabbitMQ).
   * Usado como PK para garantir idempotência no consumer.
   *
   * Não é auto-gerado — vem do campo msgId da TelemetryMessage.
   */
  @PrimaryColumn('uuid')
  id!: string

  /**
   * Nome do OpcuaClient que coletou os dados (ex: "Device01").
   * Identifica a tabela de origem e permite consultas cruzadas.
   */
  @Column('varchar', { length: 255 })
  client_name!: string

  /**
   * Timestamp da leitura OPC UA (vindo do campo `ts` da TelemetryMessage).
   */
  @Column('timestamptz')
  timestamp!: Date

  /**
   * Valores das tags lidos do OPC UA.
   * Armazenado como JSONB no PostgreSQL para flexibilidade
   * (cada ciclo de leitura pode ter tags diferentes).
   */
  @Column('jsonb')
  tags!: Record<string, EnrichedTagValue>

  /**
   * Identificador da planta/site industrial.
   */
  @Column('varchar', { length: 255 })
  site!: string

  /**
   * Linha de produção.
   */
  @Column('varchar', { length: 255 })
  line!: string

  /**
   * Identificador do host físico que executou a coleta.
   */
  @Column('varchar', { length: 255 })
  host_id!: string

  /**
   * Data/hora em que o registro foi inserido no banco.
   * Diferente do `timestamp` (que é o momento da leitura OPC UA),
   * este campo registra quando o consumer persistiu o dado.
   */
  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date
}
