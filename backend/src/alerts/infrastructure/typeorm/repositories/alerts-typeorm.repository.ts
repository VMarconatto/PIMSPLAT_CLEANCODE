/* eslint-disable prettier/prettier */

/**
 * @file alerts-typeorm.repository.ts
 * @description
 * Implementação concreta de {@link AlertsRepositoryInterface} utilizando
 * TypeORM + PostgreSQL via `QueryRunner` com SQL parametrizado.
 *
 * @remarks
 * **Estratégia de acesso ao banco:**
 * Todas as queries são executadas via `dataSource.createQueryRunner()` com
 * SQL parametrizado (`$1, $2, ...`) diretamente, sem utilizar o ORM Query Builder
 * ou `EntityManager`. Isso oferece controle total sobre a lógica de deduplicação
 * atômica (`INSERT WHERE NOT EXISTS`) e evita overhead do ORM para queries críticas
 * de alta frequência.
 *
 * **Criação de schema (lazy + idempotente):**
 * A tabela `alerts_samples` e seus índices são criados automaticamente na
 * **primeira operação** que exige acesso ao banco, via {@link ensureSchema}.
 * O flag `schemaEnsured` garante que o DDL seja executado apenas uma vez
 * por instância do repositório (singleton), sem hits redundantes ao banco.
 *
 * **Índices criados:**
 * - `idx_alerts_samples_client_ts` — suporta queries de busca por cliente ordenadas por tempo.
 * - `idx_alerts_samples_client_tag_desvio_ts` — otimiza a verificação de deduplicação
 *   e buscas filtradas por tag e nível de desvio.
 *
 * **Injeção de dependência:** Decorado com `@injectable()` e `@inject('DataSource')`
 * para integração com o container tsyringe registrado em `container/index.ts`.
 *
 * @module alerts/infrastructure/typeorm/repositories/alerts-typeorm
 */

import { randomUUID } from 'crypto'
import { inject, injectable } from 'tsyringe'
import { DataSource, QueryRunner } from 'typeorm'
import { AlertSummaryOutput } from '../../../../common/domain/repositories/repository.interface.js'
import {
  AlertsRepositoryInterface,
  CreateAlertInput,
  SearchAlertsInput,
} from '../../../domain/repositories/AlertsRepository.js'
import { AlertsSample } from '../../../domain/models/AlertsSample.js'

/**
 * Repositório de alertas com persistência em PostgreSQL via TypeORM.
 *
 * @remarks
 * Implementa {@link AlertsRepositoryInterface}, satisfazendo o contrato
 * exigido pelos casos de uso do módulo Alerts.
 *
 * Registrado como **singleton** no container DI para preservar o estado do
 * flag `schemaEnsured` entre requisições, evitando DDL redundante.
 *
 * @implements {AlertsRepositoryInterface}
 */
@injectable()
export class AlertsTypeormRepository implements AlertsRepositoryInterface {
  /**
   * Flag que indica se o schema da tabela `alerts_samples` já foi garantido
   * nesta instância do repositório.
   *
   * @remarks
   * Evita executar o DDL (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
   * a cada operação. Resetado para `false` apenas ao reiniciar o processo.
   */
  private schemaEnsured = false

  /**
   * Cria uma nova instância do repositório.
   *
   * @param {DataSource} dataSource - Conexão TypeORM com o PostgreSQL,
   *   injetada pelo container DI via token `'DataSource'`.
   */
  constructor(
    @inject('DataSource')
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Insere um alerta incondicionalmente na tabela `alerts_samples`.
   *
   * @remarks
   * Garante o schema antes da inserção (idempotente).
   * Gera um UUID v4 aleatório como `id` do registro.
   * Campos opcionais `site` e `unidade` recebem string vazia como padrão.
   * O campo `recipients` é serializado como JSONB.
   *
   * @param {CreateAlertInput} props - Dados completos do alerta a persistir.
   * @returns {Promise<AlertsSample>} Entidade {@link AlertsSample} com os dados
   *   retornados pelo banco (`RETURNING *`), incluindo `id` e `created_at`.
   *
   * @throws {Error} Quando `props.timestamp` não é conversível em `Date` válida.
   * @throws {Error} Em caso de falha de conexão ou constraint violation no PostgreSQL.
   */
  async insert(props: CreateAlertInput): Promise<AlertsSample> {
    const qr = this.dataSource.createQueryRunner()
    try {
      await this.ensureSchema(qr)

      const timestamp = this.toDate(props.timestamp)
      const id = randomUUID()
      const rows = await qr.query(
        `INSERT INTO alerts_samples
          (id, client_id, site, "timestamp", tag_name, value, desvio, alerts_count, unidade, recipients)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING *`,
        [
          id,
          props.clientId,
          props.site ?? '',
          timestamp,
          props.tagName,
          props.value,
          props.desvio,
          props.alertsCount,
          props.unidade ?? '',
          JSON.stringify(props.recipients ?? []),
        ],
      )

      console.log('[TYPEORM][ALERT][INSERT]', { id, clientId: props.clientId, tagName: props.tagName, desvio: props.desvio })
      return this.rowToModel(rows[0])
    } finally {
      await qr.release()
    }
  }

  /**
   * Insere um alerta apenas se não existir outro recente com o mesmo
   * par `(clientId, site, tagName, desvio)` dentro da janela temporal informada.
   *
   * @remarks
   * **Implementação atômica via SQL:**
   * Utiliza `INSERT ... SELECT ... WHERE NOT EXISTS (...)` para garantir que
   * a verificação de existência e a inserção ocorram atomicamente, sem
   * condição de corrida em cenários de alta frequência.
   *
   * **Janela de deduplicação:**
   * `threshold = timestamp - dedupWindowMs`. A query verifica se existe algum
   * registro com o mesmo `(client_id, site, tag_name, desvio)` cujo `timestamp`
   * esteja entre `threshold` e `timestamp` (inclusive).
   *
   * **Retorno `null`:**
   * Quando a query não insere nenhuma linha (deduplicação ativada), retorna `null`.
   * O caso de uso interpreta `null` como "alerta suprimido" e define `saved: false`.
   *
   * @param {CreateAlertInput} props         - Dados completos do alerta.
   * @param {number}           dedupWindowMs - Janela de deduplicação em milissegundos.
   *
   * @returns {Promise<AlertsSample | null>}
   *   Entidade {@link AlertsSample} persistida, ou `null` quando suprimida por deduplicação.
   *
   * @throws {Error} Quando `props.timestamp` não é conversível em `Date` válida.
   * @throws {Error} Em caso de falha de conexão ou erro de SQL no PostgreSQL.
   */
  async insertIfNotRecent(
    props: CreateAlertInput,
    dedupWindowMs: number,
  ): Promise<AlertsSample | null> {
    const qr = this.dataSource.createQueryRunner()
    try {
      await this.ensureSchema(qr)

      const timestamp = this.toDate(props.timestamp)
      /** Limite inferior da janela de deduplicação: `timestamp − dedupWindowMs`. */
      const threshold = new Date(timestamp.getTime() - dedupWindowMs)

      const rows = await qr.query(
        `INSERT INTO alerts_samples
          (id, client_id, site, "timestamp", tag_name, value, desvio, alerts_count, unidade, recipients)
         SELECT $1::uuid, $2::varchar, $3::varchar, $4::timestamptz, $5::varchar, $6::double precision, $7::varchar, $8::integer, $9::varchar, $10::jsonb
         WHERE NOT EXISTS (
           SELECT 1
           FROM alerts_samples
           WHERE client_id = $2::varchar
             AND site = $3::varchar
             AND tag_name = $5::varchar
             AND desvio = $7::varchar
             AND "timestamp" >= $11::timestamptz
             AND "timestamp" <= $4::timestamptz
         )
         RETURNING *`,
        [
          randomUUID(),
          props.clientId,
          props.site ?? '',
          timestamp,
          props.tagName,
          props.value,
          props.desvio,
          props.alertsCount,
          props.unidade ?? '',
          JSON.stringify(props.recipients ?? []),
          threshold,
        ],
      )

      if (rows.length === 0) {
        console.log('[TYPEORM][ALERT][DEDUP_SKIP]', { clientId: props.clientId, tagName: props.tagName, desvio: props.desvio })
        return null
      }
      console.log('[TYPEORM][ALERT][INSERT_IF_NOT_RECENT]', { clientId: props.clientId, tagName: props.tagName, desvio: props.desvio, id: rows[0].id })
      return this.rowToModel(rows[0])
    } finally {
      await qr.release()
    }
  }

  /**
   * Retorna os alertas mais recentes de um cliente, sem filtros adicionais.
   *
   * @remarks
   * Delegação direta para {@link findByFilters} com apenas `clientId` e `limit`.
   *
   * @param {string} clientId   - Identificador único do cliente OPC UA.
   * @param {number} [limit=100] - Número máximo de registros a retornar.
   * @returns {Promise<AlertsSample[]>} Lista de alertas ordenados por `timestamp DESC`.
   */
  async findLatestByClient(clientId: string, limit = 100): Promise<AlertsSample[]> {
    return this.findByFilters({ clientId, limit })
  }

  /**
   * Busca alertas com suporte a filtros opcionais de tag, site e intervalo temporal.
   *
   * @remarks
   * **Construção dinâmica da query:**
   * As cláusulas `WHERE` são construídas dinamicamente com base nos filtros
   * presentes em `input`. Parâmetros são indexados sequencialmente (`$1`, `$2`, ...)
   * para evitar SQL injection. O `LIMIT` é sempre aplicado.
   *
   * **Clamp do limite:** O valor de `limit` é limitado ao intervalo `[1, 500]`
   * e truncado para inteiro, prevenindo queries sem limite ou excessivamente grandes.
   *
   * **Ordenação:** Resultados ordenados por `timestamp DESC` (mais recentes primeiro).
   *
   * @param {SearchAlertsInput} input - Parâmetros de busca.
   * @param {string}  input.clientId   - Identificador do cliente (obrigatório).
   * @param {number}  [input.limit=100] - Limite de resultados (clamped em [1, 500]).
   * @param {string}  [input.tagName]   - Filtro exato por nome de tag.
   * @param {string}  [input.site]      - Filtro exato por nome de site.
   * @param {Date}    [input.startDate] - Filtro de `timestamp >= startDate`.
   * @param {Date}    [input.endDate]   - Filtro de `timestamp <= endDate`.
   *
   * @returns {Promise<AlertsSample[]>}
   *   Array de entidades {@link AlertsSample} que satisfazem os filtros,
   *   ordenado por `timestamp DESC`. Retorna `[]` se nenhum registro for encontrado.
   *
   * @throws {Error} Em caso de falha de conexão com o PostgreSQL.
   */
  async findByFilters(input: SearchAlertsInput): Promise<AlertsSample[]> {
    const qr = this.dataSource.createQueryRunner()
    try {
      await this.ensureSchema(qr)

      /** Limite clamped no intervalo [1, 500] para evitar queries irrestringidas. */
      const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)))
      const conditions: string[] = ['client_id = $1']
      const params: unknown[] = [input.clientId]
      let index = 2

      if (input.tagName && input.tagName.trim() !== '') {
        conditions.push(`tag_name = $${index}`)
        params.push(input.tagName.trim())
        index += 1
      }

      if (input.site && input.site.trim() !== '') {
        conditions.push(`site = $${index}`)
        params.push(input.site.trim())
        index += 1
      }

      if (input.startDate) {
        conditions.push(`"timestamp" >= $${index}`)
        params.push(input.startDate)
        index += 1
      }

      if (input.endDate) {
        conditions.push(`"timestamp" <= $${index}`)
        params.push(input.endDate)
        index += 1
      }

      params.push(limit)

      const rows = await qr.query(
        `SELECT *
         FROM alerts_samples
         WHERE ${conditions.join(' AND ')}
         ORDER BY "timestamp" DESC
         LIMIT $${index}`,
        params,
      )

      return rows.map((row: any) => this.rowToModel(row))
    } finally {
      await qr.release()
    }
  }

  /**
   * Retorna o resumo agregado de alertas de um cliente com três queries distintas.
   *
   * @remarks
   * **Queries executadas:**
   * 1. **Base:** `COUNT(*)` total e `MAX(timestamp)` do cliente.
   * 2. **Por nível:** `COUNT(*) GROUP BY desvio` — distribuição por nível de desvio.
   * 3. **Por tag:** `COUNT(*) GROUP BY tag_name` — distribuição por tag OPC UA.
   *
   * Os resultados são combinados no objeto {@link AlertSummaryOutput}.
   * Chaves `desvio` nulas são normalizadas para `'UNKNOWN'` (uppercase).
   * Chaves `tag_name` nulas são normalizadas para `'(sem tag)'`.
   *
   * @param {string} clientId - Identificador único do cliente OPC UA.
   * @returns {Promise<AlertSummaryOutput>}
   *   Objeto com `clientId`, `total`, `byLevel`, `byTag` e `lastTimestamp` (ISO 8601 ou `null`).
   *
   * @throws {Error} Em caso de falha de conexão com o PostgreSQL.
   */
  async summarizeByClient(clientId: string): Promise<AlertSummaryOutput> {
    const qr = this.dataSource.createQueryRunner()
    try {
      await this.ensureSchema(qr)

      const baseRows = await qr.query(
        `SELECT
           COUNT(*)::int AS total,
           MAX("timestamp") AS last_timestamp
         FROM alerts_samples
         WHERE client_id = $1`,
        [clientId],
      )

      const levelRows = await qr.query(
        `SELECT desvio, COUNT(*)::int AS count
         FROM alerts_samples
         WHERE client_id = $1
         GROUP BY desvio`,
        [clientId],
      )

      const tagRows = await qr.query(
        `SELECT tag_name, COUNT(*)::int AS count
         FROM alerts_samples
         WHERE client_id = $1
         GROUP BY tag_name`,
        [clientId],
      )

      const byLevel: Record<string, number> = {}
      const byTag: Record<string, number> = {}

      for (const row of levelRows) {
        byLevel[String(row.desvio ?? 'UNKNOWN').toUpperCase()] = Number(row.count ?? 0)
      }

      for (const row of tagRows) {
        byTag[String(row.tag_name ?? '(sem tag)')] = Number(row.count ?? 0)
      }

      const base = baseRows[0] ?? { total: 0, last_timestamp: null }
      const lastTimestamp = base.last_timestamp
        ? new Date(base.last_timestamp).toISOString()
        : null

      return {
        clientId,
        total: Number(base.total ?? 0),
        byLevel,
        byTag,
        lastTimestamp,
      }
    } finally {
      await qr.release()
    }
  }

  /**
   * Converte um valor `string | Date` em objeto `Date` validado.
   *
   * @remarks
   * Strings são convertidas via `new Date(value)`.
   * Lança erro descritivo se o resultado for um `Date` inválido (`NaN`),
   * evitando que timestamps corrompidos sejam persistidos silenciosamente.
   *
   * @param {string | Date} value - Valor de timestamp a converter.
   * @returns {Date} Objeto `Date` válido.
   *
   * @throws {Error} Quando `value` não é conversível em `Date` válida.
   */
  private toDate(value: string | Date): Date {
    const parsed = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid alert timestamp: ${String(value)}`)
    }
    return parsed
  }

  /**
   * Garante que a tabela `alerts_samples` e seus índices existem no PostgreSQL.
   *
   * @remarks
   * **Idempotência:** Utiliza `CREATE TABLE IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`,
   * tornando a operação segura para execuções repetidas sem efeito colateral.
   *
   * **Flag `schemaEnsured`:** Após a primeira execução bem-sucedida, define o flag
   * como `true` e retorna imediatamente nas chamadas subsequentes, eliminando
   * round-trips desnecessários ao banco por instância do repositório.
   *
   * **Colunas criadas:**
   * - `id UUID PRIMARY KEY`
   * - `client_id VARCHAR(255) NOT NULL`
   * - `site VARCHAR(255) NOT NULL DEFAULT ''` (adicionada via `ALTER TABLE ADD COLUMN IF NOT EXISTS`)
   * - `timestamp TIMESTAMPTZ NOT NULL`
   * - `tag_name VARCHAR(255) NOT NULL`
   * - `value DOUBLE PRECISION NOT NULL`
   * - `desvio VARCHAR(16) NOT NULL`
   * - `alerts_count INTEGER NOT NULL DEFAULT 1`
   * - `unidade VARCHAR(100) NOT NULL DEFAULT ''`
   * - `recipients JSONB NOT NULL DEFAULT '[]'::jsonb`
   * - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   *
   * @param {QueryRunner} qr - QueryRunner ativo para executar as queries DDL.
   * @returns {Promise<void>}
   *
   * @throws {Error} Em caso de falha de conexão ou erro de permissão no PostgreSQL.
   */
  private async ensureSchema(qr: QueryRunner): Promise<void> {
    if (this.schemaEnsured) return

    await qr.query(`
      CREATE TABLE IF NOT EXISTS alerts_samples (
        id UUID PRIMARY KEY,
        client_id VARCHAR(255) NOT NULL,
        site VARCHAR(255) NOT NULL DEFAULT '',
        "timestamp" TIMESTAMPTZ NOT NULL,
        tag_name VARCHAR(255) NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        desvio VARCHAR(16) NOT NULL,
        alerts_count INTEGER NOT NULL DEFAULT 1,
        unidade VARCHAR(100) NOT NULL DEFAULT '',
        recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    /** Migração não-destrutiva: adiciona a coluna `site` caso não exista (retrocompatibilidade). */
    await qr.query(`
      ALTER TABLE alerts_samples
      ADD COLUMN IF NOT EXISTS site VARCHAR(255) NOT NULL DEFAULT ''
    `)

    /** Índice composto para queries de busca por cliente ordenadas por tempo. */
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_samples_client_ts
      ON alerts_samples (client_id, "timestamp" DESC)
    `)

    /** Índice composto para verificação de deduplicação e filtros por tag/desvio. */
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_samples_client_tag_desvio_ts
      ON alerts_samples (client_id, tag_name, desvio, "timestamp" DESC)
    `)

    this.schemaEnsured = true
  }

  /**
   * Converte uma linha raw do PostgreSQL (`Record<string, any>`) em entidade {@link AlertsSample}.
   *
   * @remarks
   * **Normalização do campo `recipients`:**
   * O campo `recipients` é armazenado como `JSONB` e pode ser retornado pelo
   * driver como string JSON ou como array já deserializado, dependendo da versão
   * do driver `pg`. A normalização cobre ambos os casos.
   *
   * **Normalização do campo `desvio`:**
   * Convertido para uppercase e tipado como `AlertsSample['desvio']` para
   * garantir compatibilidade com o tipo union {@link AlertLevel}.
   *
   * @param {Record<string, any>} row - Linha raw retornada pelo PostgreSQL.
   * @returns {AlertsSample} Entidade de domínio mapeada a partir da linha do banco.
   */
  private rowToModel(row: any): AlertsSample {
    /** Normaliza `recipients`: pode vir como string JSON ou array deserializado. */
    const recipients =
      typeof row.recipients === 'string'
        ? JSON.parse(row.recipients)
        : row.recipients

    return new AlertsSample({
      id: String(row.id),
      clientId: String(row.client_id),
      site: String(row.site ?? ''),
      timestamp: new Date(row.timestamp),
      tagName: String(row.tag_name),
      value: Number(row.value),
      desvio: String(row.desvio).toUpperCase() as AlertsSample['desvio'],
      alertsCount: Number(row.alerts_count ?? 1),
      unidade: String(row.unidade ?? ''),
      recipients: Array.isArray(recipients) ? recipients.map(String) : [],
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
    })
  }
}
