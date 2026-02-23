/* eslint-disable prettier/prettier */

/**
 * @file alerts-sample.entity.ts
 * @description
 * Entidade TypeORM que mapeia a tabela `alerts_samples` no PostgreSQL,
 * representando um único registro de alerta industrial persistido.
 *
 * @remarks
 * **Tabela:** `alerts_samples`
 *
 * **Schema DDL equivalente:**
 * ```sql
 * CREATE TABLE alerts_samples (
 *   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   client_id   VARCHAR(255) NOT NULL,
 *   site        VARCHAR(255) NOT NULL DEFAULT '',
 *   timestamp   TIMESTAMPTZ NOT NULL,
 *   tag_name    VARCHAR(255) NOT NULL,
 *   value       DOUBLE PRECISION NOT NULL,
 *   desvio      VARCHAR(16) NOT NULL,
 *   alerts_count INTEGER NOT NULL DEFAULT 1,
 *   unidade     VARCHAR(100) NOT NULL DEFAULT '',
 *   recipients  JSONB NOT NULL DEFAULT '[]'::jsonb,
 *   created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 * ```
 *
 * **Integração:**
 * - Esta entidade é utilizada como referência de schema pelo TypeORM, mas as
 *   queries reais do módulo Alerts são executadas via `QueryRunner` raw SQL
 *   em {@link AlertsTypeormRepository} para maior controle sobre a lógica
 *   de deduplicação e performance.
 * - Corresponde ao modelo de domínio {@link AlertsSample}; a conversão entre
 *   entidade e modelo é feita manualmente em `rowToModel` do repositório.
 *
 * @module alerts/infrastructure/typeorm/entities/alerts-sample
 */

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm'

/**
 * Entidade TypeORM para a tabela `alerts_samples`.
 *
 * @remarks
 * Cada instância representa um alerta industrial gerado pelo pipeline
 * OPC UA → RabbitMQ → Consumer → PostgreSQL. Todos os campos são obrigatórios
 * (`!` non-null assertion), pois são preenchidos pelo banco na inserção ou
 * fornecidos obrigatoriamente pelo caso de uso.
 */
@Entity('alerts_samples')
export class AlertsSampleEntity {
  /**
   * Identificador único do alerta, gerado automaticamente como UUID v4
   * pelo banco de dados na inserção.
   *
   * @remarks Coluna: `id UUID PRIMARY KEY`.
   */
  @PrimaryGeneratedColumn('uuid')
  id!: string

  /**
   * Identificador do cliente OPC UA que originou o alerta.
   *
   * @remarks Coluna: `client_id VARCHAR(255) NOT NULL`.
   */
  @Column('varchar', { name: 'client_id', length: 255 })
  client_id!: string

  /**
   * Nome do site/planta industrial de onde o alerta foi emitido.
   *
   * @remarks
   * Coluna: `site VARCHAR(255) NOT NULL DEFAULT ''`.
   * Valor vazio (`''`) quando o cliente não possui site associado.
   */
  @Column('varchar', { length: 255, default: '' })
  site!: string

  /**
   * Data/hora exata (com fuso horário) em que o alerta foi gerado pelo sistema OPC UA.
   *
   * @remarks Coluna: `timestamp TIMESTAMPTZ NOT NULL`.
   */
  @Column('timestamptz')
  timestamp!: Date

  /**
   * Nome da tag OPC UA monitorada que ultrapassou o limite configurado.
   *
   * @remarks
   * Coluna: `tag_name VARCHAR(255) NOT NULL`.
   * Exemplo: `'TEMP_REACTOR_01'`, `'PRESS_OUT_PT02'`.
   */
  @Column('varchar', { name: 'tag_name', length: 255 })
  tag_name!: string

  /**
   * Valor numérico lido da tag no momento do disparo do alerta.
   *
   * @remarks Coluna: `value DOUBLE PRECISION NOT NULL`.
   */
  @Column('double precision')
  value!: number

  /**
   * Nível de desvio classificado pelo sistema de alarmes.
   *
   * @remarks
   * Coluna: `desvio VARCHAR(16) NOT NULL`.
   * Valores esperados: `'LL'` | `'L'` | `'H'` | `'HH'` | `'UNKNOWN'`.
   * Armazenado como string para compatibilidade com o tipo {@link AlertLevel} do domínio.
   */
  @Column('varchar', { length: 16 })
  desvio!: string

  /**
   * Contador acumulado de disparos de alerta para esta tag desde o último reset.
   *
   * @remarks
   * Coluna: `alerts_count INTEGER NOT NULL DEFAULT 1`.
   * Valor mínimo: `1` (o próprio alerta atual).
   */
  @Column('integer', { name: 'alerts_count', default: 1 })
  alerts_count!: number

  /**
   * Unidade de engenharia do valor medido.
   *
   * @remarks
   * Coluna: `unidade VARCHAR(100) NOT NULL DEFAULT ''`.
   * Exemplos: `'°C'`, `'bar'`, `'%'`, `'m³/h'`.
   * Valor vazio quando a unidade não está disponível.
   */
  @Column('varchar', { length: 100, default: '' })
  unidade!: string

  /**
   * Lista de destinatários (e-mails ou identificadores) notificados sobre o alerta,
   * armazenada como array JSON no PostgreSQL.
   *
   * @remarks
   * Coluna: `recipients JSONB NOT NULL DEFAULT '[]'::jsonb`.
   * Armazenado como `JSONB` para permitir queries parciais e indexação futura.
   * O TypeORM retorna este campo já deserializado como `string[]`.
   */
  @Column('jsonb', { default: () => "'[]'::jsonb" })
  recipients!: string[]

  /**
   * Data/hora de inserção do registro no banco de dados, preenchida
   * automaticamente pelo PostgreSQL com `DEFAULT now()`.
   *
   * @remarks
   * Coluna: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
   * Gerenciada pelo decorador `@CreateDateColumn` do TypeORM.
   */
  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date
}
