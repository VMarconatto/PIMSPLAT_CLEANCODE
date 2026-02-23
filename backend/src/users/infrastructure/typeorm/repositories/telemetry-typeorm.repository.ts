/* eslint-disable prettier/prettier */

import { injectable, inject } from 'tsyringe'
import { DataSource } from 'typeorm'

import { TelemetryRepositoryInterface } from '../../../domain/repositories/TelemetryRepository.js'
import { TelemetrySample } from '../../../domain/models/TelemetrySample.js'
import { TelemetryMessage } from '../../../../messaging/types.js'
import { SearchInput, SearchOutput } from '../../../../common/domain/repositories/repository.interface.js'
import { NotFoundError } from '../../../../common/domain/errors/not-found-error.js'
import { ConflictError } from '../../../../common/domain/errors/conflict-error.js'

/**
 * @file telemetry-typeorm.repository.ts
 * @description
 * Implementação concreta do repositório de telemetria usando TypeORM + PostgreSQL
 * no contexto de ingestão industrial (OPC UA -> RabbitMQ -> Consumer -> Postgres).
 *
 * Contexto:
 * - Cada OpcuaClient (clientName) possui sua própria tabela no banco.
 * - As tabelas são criadas dinamicamente via ensureTable (CREATE TABLE IF NOT EXISTS).
 * - Os dados são armazenados com tags em JSONB para flexibilidade.
 * - A camada de aplicação chama este repositório via ReadCycleUseCase.
 *
 * Fluxo:
 * Consumer RabbitMQ → ReadCycleUseCase → TelemetryTypeormRepository → PostgreSQL
 */

/**
 * Sanitiza o nome do client para uso seguro como nome de tabela.
 * Permite apenas letras, números e underscores.
 *
 * @param clientName - Nome lógico do client OPC UA recebido no payload.
 * @returns Nome de tabela seguro no formato `telemetry_<client_sanitizado>`.
 */
function safeTableName(clientName: string): string {
  /** Nome do client com caracteres inválidos substituídos por `_` e em minúsculas. */
  const sanitized = clientName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
  return `telemetry_${sanitized}`
}

/**
 * Repositório TypeORM para persistência e consulta de telemetria.
 *
 * @implements TelemetryRepositoryInterface
 */
@injectable()
export class TelemetryTypeormRepository implements TelemetryRepositoryInterface {
  /** Cache de tabelas já criadas para evitar queries desnecessárias. */
  private ensuredTables = new Set<string>()

  /**
   * @param dataSource - Instância compartilhada do TypeORM DataSource injetada via DI.
   */
  constructor(
    @inject('DataSource')
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Garante que a tabela do client existe no PostgreSQL.
   * Operação idempotente — usa CREATE TABLE IF NOT EXISTS.
   * Cria índice no campo timestamp para queries temporais.
   *
   * @param clientName - Nome do client OPC UA (origina o nome da tabela física).
   * @returns Promise<void>
   */
  async ensureTable(clientName: string): Promise<void> {
    /** Nome da tabela física para o client informado. */
    const table = safeTableName(clientName)

    if (this.ensuredTables.has(table)) return

    /** QueryRunner isolado para executar DDL desta operação. */
    const qr = this.dataSource.createQueryRunner()
    try {
      await qr.query(`
        CREATE TABLE IF NOT EXISTS "${table}" (
          id UUID PRIMARY KEY,
          client_name VARCHAR(255) NOT NULL,
          "timestamp" TIMESTAMPTZ NOT NULL,
          tags JSONB NOT NULL DEFAULT '{}',
          site VARCHAR(255) NOT NULL DEFAULT '',
          line VARCHAR(255) NOT NULL DEFAULT '',
          host_id VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      await qr.query(`
        CREATE INDEX IF NOT EXISTS "idx_${table}_timestamp"
        ON "${table}" ("timestamp" DESC)
      `)

      this.ensuredTables.add(table)
    } finally {
      await qr.release()
    }
  }

  /**
   * Insere uma única amostra de telemetria.
   * Converte TelemetryMessage (RabbitMQ) → row do banco → TelemetrySample (domínio).
   *
   * @param clientName - Nome do client OPC UA, usado para resolver a tabela dinâmica.
   * @param props - Payload de telemetria consumido do RabbitMQ.
   * @returns Amostra persistida convertida para model de domínio.
   * @throws ConflictError quando a PK (msgId) já existe para a tabela do client.
   */
  async insert(clientName: string, props: TelemetryMessage): Promise<TelemetrySample> {
    /** Nome da tabela de destino para o insert. */
    const table = safeTableName(clientName)
    /** QueryRunner para executar SQL bruto com controle de ciclo de vida. */
    const qr = this.dataSource.createQueryRunner()

    try {
      /** Resultado do INSERT com RETURNING *, contendo 1 linha quando inserido com sucesso. */
      const rows = await qr.query(
        `INSERT INTO "${table}" (id, client_name, "timestamp", tags, site, line, host_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          props.msgId,
          props.clientId,
          new Date(props.ts),
          JSON.stringify(props.tags),
          props.site ?? '',
          props.line ?? '',
          props.hostId ?? '',
        ],
      )

      /** Linha recém-inserida, usada para observabilidade do último ponto de persistência. */
      const inserted = rows[0]
      console.log('[TYPEORM][LAST-POINT][INSERTED_ROW]', {
        table,
        id: inserted?.id,
        client_name: inserted?.client_name,
        timestamp: inserted?.timestamp,
        tags: inserted?.tags,
        site: inserted?.site,
        line: inserted?.line,
        host_id: inserted?.host_id,
        created_at: inserted?.created_at,
      })

      return this.rowToModel(rows[0])
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictError(`Duplicate msgId "${props.msgId}" for client "${clientName}"`, {
          msgId: props.msgId,
          clientName,
        }, 'DATABASE')
      }
      throw err
    } finally {
      await qr.release()
    }
  }

  /**
   * Insere múltiplas amostras em lote.
   *
   * @param clientName - Nome do client OPC UA (define a tabela dinâmica).
   * @param props - Lote de mensagens de telemetria a persistir.
   * @returns Lista de amostras efetivamente inseridas (duplicadas são ignoradas).
   */
  async insertBatch(clientName: string, props: TelemetryMessage[]): Promise<TelemetrySample[]> {
    if (props.length === 0) return []

    /** Tabela de destino para todo o lote. */
    const table = safeTableName(clientName)
    /** QueryRunner com transação explícita para o batch. */
    const qr = this.dataSource.createQueryRunner()

    try {
      await qr.startTransaction()

      /** Acumulador dos modelos persistidos no batch. */
      const results: TelemetrySample[] = []

      /** Mensagem individual do lote em processamento. */
      for (const msg of props) {
        /** Resultado de cada tentativa de insert; vazio quando ON CONFLICT DO NOTHING. */
        const rows = await qr.query(
          `INSERT INTO "${table}" (id, client_name, "timestamp", tags, site, line, host_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING
           RETURNING *`,
          [
            msg.msgId,
            msg.clientId,
            new Date(msg.ts),
            JSON.stringify(msg.tags),
            msg.site ?? '',
            msg.line ?? '',
            msg.hostId ?? '',
          ],
        )

        if (rows.length > 0) {
          results.push(this.rowToModel(rows[0]))
        }
      }

      await qr.commitTransaction()
      return results
    } catch (err: unknown) {
      await qr.rollbackTransaction()
      throw err
    } finally {
      await qr.release()
    }
  }

  /**
   * Busca uma amostra pelo msgId (UUID).
   *
   * @param clientName - Nome do client OPC UA (define a tabela alvo).
   * @param id - Identificador único da mensagem/amostra.
   * @returns Amostra encontrada.
   * @throws NotFoundError quando não existe registro para o id informado.
   */
  async findById(clientName: string, id: string): Promise<TelemetrySample> {
    /** Tabela dinâmica vinculada ao client. */
    const table = safeTableName(clientName)
    /** QueryRunner para leitura pontual. */
    const qr = this.dataSource.createQueryRunner()

    try {
      /** Resultado da consulta por chave primária. */
      const rows = await qr.query(
        `SELECT * FROM "${table}" WHERE id = $1 LIMIT 1`,
        [id],
      )

      if (rows.length === 0) {
        throw new NotFoundError(`Telemetry sample not found`, {
          id,
          clientName,
        })
      }

      return this.rowToModel(rows[0])
    } finally {
      await qr.release()
    }
  }

  /**
   * Busca as amostras mais recentes de um client.
   *
   * @param clientName - Nome do client OPC UA (define a tabela alvo).
   * @param limit - Quantidade máxima de registros retornados (default: 100).
   * @returns Lista de amostras ordenadas por timestamp decrescente.
   */
  async findLatest(clientName: string, limit = 100): Promise<TelemetrySample[]> {
    /** Tabela dinâmica vinculada ao client. */
    const table = safeTableName(clientName)
    /** QueryRunner para consulta de leitura. */
    const qr = this.dataSource.createQueryRunner()

    try {
      /** Linhas retornadas pelo banco já ordenadas por timestamp DESC. */
      const rows = await qr.query(
        `SELECT * FROM "${table}" ORDER BY "timestamp" DESC LIMIT $1`,
        [limit],
      )

      return rows.map((r: any) => this.rowToModel(r))
    } finally {
      await qr.release()
    }
  }

  /**
   * Busca amostras dentro de um intervalo temporal.
   *
   * @param clientName - Nome do client OPC UA (define a tabela alvo).
   * @param startDate - Data/hora inicial inclusiva do filtro.
   * @param endDate - Data/hora final inclusiva do filtro.
   * @returns Lista de amostras dentro da janela temporal.
   */
  async findByTimeRange(
    clientName: string,
    startDate: Date,
    endDate: Date,
  ): Promise<TelemetrySample[]> {
    /** Tabela dinâmica vinculada ao client. */
    const table = safeTableName(clientName)
    /** QueryRunner para consulta por intervalo. */
    const qr = this.dataSource.createQueryRunner()

    try {
      /** Linhas filtradas por timestamp e ordenadas por recência. */
      const rows = await qr.query(
        `SELECT * FROM "${table}"
         WHERE "timestamp" >= $1 AND "timestamp" <= $2
         ORDER BY "timestamp" DESC`,
        [startDate, endDate],
      )

      return rows.map((r: any) => this.rowToModel(r))
    } finally {
      await qr.release()
    }
  }

  /**
   * Remove amostras anteriores a uma data (retenção de dados).
   *
   * @param clientName - Nome do client OPC UA (define a tabela alvo).
   * @param before - Limite temporal; registros com timestamp menor serão removidos.
   * @returns Quantidade de linhas removidas.
   */
  async deleteOlderThan(clientName: string, before: Date): Promise<number> {
    /** Tabela dinâmica vinculada ao client. */
    const table = safeTableName(clientName)
    /** QueryRunner para comando de deleção. */
    const qr = this.dataSource.createQueryRunner()

    try {
      /** Resultado bruto do DELETE; no driver pg, rowCount vem na posição [1]. */
      const result = await qr.query(
        `DELETE FROM "${table}" WHERE "timestamp" < $1`,
        [before],
      )

      return result[1] ?? 0 // rowCount
    } finally {
      await qr.release()
    }
  }

  /**
   * Busca paginada com filtro temporal e por tag.
   *
   * @param props - Objeto de busca (clientName, paginação, ordenação e filtros opcionais).
   * @returns Estrutura paginada com itens e metadados de consulta.
   */
  async search(props: SearchInput): Promise<SearchOutput<TelemetrySample>> {
    /** Tabela dinâmica do client consultado. */
    const table = safeTableName(props.clientName)
    /** Página solicitada (base 1). */
    const page = props.page ?? 1
    /** Tamanho da página solicitado. */
    const perPage = props.per_page ?? 15
    /** Deslocamento no conjunto total para paginação SQL. */
    const offset = (page - 1) * perPage
    /** Campo de ordenação aplicado na query. */
    const sortField = props.sort ?? 'timestamp'
    /** Direção da ordenação (`asc` ou `desc`). */
    const sortDir = props.sort_dir ?? 'desc'

    /** QueryRunner para operações de count + fetch da página. */
    const qr = this.dataSource.createQueryRunner()

    try {
      /** Partes dinâmicas do WHERE acumuladas conforme filtros recebidos. */
      const conditions: string[] = []
      /** Valores parametrizados para evitar interpolação direta em filtros. */
      const params: any[] = []
      /** Índice de parâmetro posicional SQL ($1, $2, ...). */
      let paramIndex = 1

      if (props.startDate) {
        conditions.push(`"timestamp" >= $${paramIndex++}`)
        params.push(props.startDate)
      }

      if (props.endDate) {
        conditions.push(`"timestamp" <= $${paramIndex++}`)
        params.push(props.endDate)
      }

      if (props.tagFilter) {
        conditions.push(`tags ? $${paramIndex++}`)
        params.push(props.tagFilter)
      }

      /** Cláusula WHERE final, vazia quando não há filtros. */
      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : ''

      /** Resultado do COUNT(*) para cálculo de paginação. */
      const countResult = await qr.query(
        `SELECT COUNT(*) as total FROM "${table}" ${whereClause}`,
        params,
      )
      /** Total numérico de registros compatíveis com os filtros. */
      const total = parseInt(countResult[0].total, 10)

      /** Linhas da página atual aplicando WHERE/ORDER/LIMIT/OFFSET. */
      const rows = await qr.query(
        `SELECT * FROM "${table}" ${whereClause}
         ORDER BY "${sortField}" ${sortDir.toUpperCase()}
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...params, perPage, offset],
      )

      return {
        items: rows.map((r: any) => this.rowToModel(r)),
        per_page: perPage,
        total,
        current_page: page,
        sort: sortField,
        sort_dir: sortDir,
        clientName: props.clientName,
      }
    } finally {
      await qr.release()
    }
  }

  /**
   * Verifica se uma amostra com o dado msgId já existe (idempotência).
   *
   * @param clientName - Nome do client OPC UA (define a tabela alvo).
   * @param msgId - Identificador único da mensagem.
   * @returns `true` quando já existe registro com esse msgId; caso contrário `false`.
   */
  async existsByMsgId(clientName: string, msgId: string): Promise<boolean> {
    /** Tabela dinâmica vinculada ao client. */
    const table = safeTableName(clientName)
    /** QueryRunner para consulta de existência. */
    const qr = this.dataSource.createQueryRunner()

    try {
      /** Resultado da consulta minimalista de existência (`SELECT 1`). */
      const rows = await qr.query(
        `SELECT 1 FROM "${table}" WHERE id = $1 LIMIT 1`,
        [msgId],
      )

      return rows.length > 0
    } finally {
      await qr.release()
    }
  }

  /**
   * Converte uma row do banco para o model de domínio TelemetrySample.
   *
   * @param row - Linha bruta retornada pelo driver do PostgreSQL.
   * @returns Instância de TelemetrySample pronta para uso na camada de aplicação.
   */
  private rowToModel(row: any): TelemetrySample {
    /** Campo tags normalizado para objeto quando vier serializado como string. */
    const normalizedTags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags

    return new TelemetrySample({
      id: row.id,
      clientName: row.client_name,
      timestamp: new Date(row.timestamp),
      tags: normalizedTags,
      site: row.site ?? '',
      line: row.line ?? '',
      hostId: row.host_id ?? '',
    })
  }
}
