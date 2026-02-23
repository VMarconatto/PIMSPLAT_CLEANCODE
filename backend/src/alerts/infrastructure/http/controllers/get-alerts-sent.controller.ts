/* eslint-disable prettier/prettier */

/**
 * @file get-alerts-sent.controller.ts
 * @description
 * Controller HTTP para `GET /:clientId/alerts-sent`.
 *
 * @remarks
 * **Dois modos de leitura:**
 *
 * 1. **Multi-DB** (`ALERTS_MULTI_DB_READ=true`, padrão ativado):
 *    Consulta múltiplos bancos PostgreSQL em paralelo — um por área industrial
 *    (pasteurizacao, utilidades, recepcao, estocagem_de_leite_cru, expedicao_de_creme, alsafe).
 *    Os resultados são mesclados, ordenados por `timestamp DESC` e truncados pelo `limit`.
 *    Retorna objetos no formato {@link LegacyAlertPayload}.
 *
 * 2. **Single-DB** (`ALERTS_MULTI_DB_READ=false`):
 *    Delega ao caso de uso {@link GetAlertsSentUseCase}, que acessa o banco
 *    principal via {@link AlertsTypeormRepository}. Retorna o mesmo formato
 *    legado via `alert.toLegacyPayload()`.
 *
 * **Construção do intervalo temporal:**
 * O intervalo de busca é especificado por partes de data/hora separadas
 * (`startYear`, `startMonth`, ..., `endHour`, `endMinute`) em vez de strings ISO.
 * Isso evita ambiguidades de parsing e permite especificar intervalos parciais:
 * - Sem nenhuma parte → última hora (agora − 1 h até agora).
 * - Apenas start → `[start, start + 1h]`.
 * - Apenas end → `[end − 1h, end]`.
 * - Ambos → `[start, end]`.
 *
 * **Suporte a fuso horário:** O parâmetro `tzOffsetMinutes` permite que o
 * cliente informe seu offset UTC (ex.: `-180` para BRT/UTC-3), fazendo com que
 * as partes de data sejam interpretadas no horário local do cliente.
 *
 * @module alerts/infrastructure/http/controllers/get-alerts-sent
 */

import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { z } from 'zod'
import { Client as PgClient } from 'pg'
import { dataValidation } from '../../../../common/infrastructure/validation/zod/index.js'
import { BadRequestError } from '../../../../common/domain/errors/bad-request-error.js'
import { GetAlertsSentUseCase } from '../../../app/usecases/get-alerts-sent.usecase.js'
import { toAreaSlug } from '../../../../config/rabbit.js'

/**
 * Partes individuais de uma data/hora para composição de um filtro temporal.
 *
 * @remarks
 * Todos os campos são opcionais. Campos ausentes recebem valores padrão
 * durante a construção via {@link buildDateFromParts}:
 * - `year`, `month`, `day`, `hour` — derivados de `new Date()` (agora).
 * - `minute` — `0` para `startDate`, `59` para `endDate` (`endOfHour=true`).
 *
 * @property {number} [year]   - Ano (ex.: `2025`). Válido: 1970–9999.
 * @property {number} [month]  - Mês (1–12).
 * @property {number} [day]    - Dia do mês (1–31).
 * @property {number} [hour]   - Hora do dia (0–23).
 * @property {number} [minute] - Minuto (0–59).
 */
type DateParts = {
  year?: number
  month?: number
  day?: number
  hour?: number
  minute?: number
}

/** Duração de uma hora em milissegundos. Usado como janela padrão de busca. */
const ONE_HOUR_MS = 60 * 60 * 1000

/**
 * Offset máximo de fuso horário aceito em minutos (±14 horas = ±840 min).
 *
 * @remarks
 * Cobre todos os fusos horários válidos da Terra, incluindo UTC+14 (Linha de Data).
 */
const MAX_TZ_OFFSET_MINUTES = 14 * 60

/**
 * Schema PostgreSQL padrão usado quando `ALERTS_DB_SCHEMA` e `DB_SCHEMA` não estão definidos.
 */
const DEFAULT_ALERTS_SCHEMA = 'public'

/** Usuário PostgreSQL padrão para conexões multi-DB quando `ALERTS_DB_USER`/`DB_USER` ausentes. */
const DEFAULT_ALERTS_DB_USER = 'postgres'

/** Senha PostgreSQL padrão para conexões multi-DB quando `ALERTS_DB_PASS`/`DB_PASS` ausentes. */
const DEFAULT_ALERTS_DB_PASS = 'postgres'

/** Número máximo de alertas retornados quando o parâmetro `limit` não é fornecido. */
const DEFAULT_ALERTS_LIMIT = 100

/**
 * Formato de payload de alerta compatível com o frontend legado.
 *
 * @remarks
 * Este é o formato de resposta do endpoint `alerts-sent`, mantido para
 * retrocompatibilidade com consumidores existentes. Corresponde ao retorno
 * de {@link AlertsSample.toLegacyPayload}.
 *
 * @property {string}                  timestamp  - Data/hora do alerta em ISO 8601.
 * @property {Record<string, unknown>} alertData  - Dados da tag: `{ [tagName]: value, AlertsCount, Desvio, Unidade }`.
 * @property {string[]}                recipients - Lista de destinatários notificados.
 * @property {string}                  clientId   - Identificador do cliente OPC UA.
 * @property {string}                  [site]     - Nome do site/área industrial. Opcional.
 */
type LegacyAlertPayload = {
  timestamp: string
  alertData: Record<string, unknown>
  recipients: string[]
  clientId: string
  site?: string
}

/**
 * Parâmetros de conexão para um banco de dados de área industrial específico.
 *
 * @remarks
 * Utilizado no modo multi-DB para conectar diretamente a cada banco de área
 * via `pg.Client`, independente do DataSource TypeORM principal.
 *
 * @property {string} slug     - Identificador canônico da área (ex.: `'pasteurizacao'`).
 * @property {string} host     - Host do servidor PostgreSQL da área.
 * @property {number} port     - Porta do servidor PostgreSQL da área.
 * @property {string} database - Nome do banco de dados da área.
 * @property {string} schema   - Schema PostgreSQL a ser consultado (ex.: `'public'`).
 * @property {string} user     - Usuário de autenticação PostgreSQL.
 * @property {string} password - Senha de autenticação PostgreSQL.
 */
type AlertsDbTarget = {
  slug: string
  host: string
  port: number
  database: string
  schema: string
  user: string
  password: string
}

/**
 * Parâmetros internos de busca de alertas, usados tanto no modo single-DB
 * quanto no modo multi-DB.
 *
 * @property {string} clientId   - Identificador do cliente OPC UA. Obrigatório.
 * @property {number} limit      - Número máximo de registros a retornar.
 * @property {string} [tagName]  - Filtro por nome de tag OPC UA.
 * @property {string} [site]     - Filtro por nome de área/site.
 * @property {Date}   [startDate] - Início do intervalo temporal (inclusivo).
 * @property {Date}   [endDate]  - Fim do intervalo temporal (inclusivo).
 */
type AlertsSearchInput = {
  clientId: string
  limit: number
  tagName?: string
  site?: string
  startDate?: Date
  endDate?: Date
}

/**
 * Mapa de aliases canônicos de slugs de site.
 *
 * @remarks
 * Alguns sites possuem nomes legados (antes da padronização de slugs) que
 * diferem do slug do banco de dados correspondente. Este mapa permite que
 * requisições com os nomes legados sejam corretamente roteadas para o banco correto.
 *
 * Exemplos de mapeamento:
 * - `'recebimento_de_leite_cru'` → `'recepcao'`
 * - `'despacho_de_creme'` → `'expedicao_de_creme'`
 * - `'estocagem_de_pasteurizado'` → `'pasteurizacao'`
 */
const SITE_SLUG_ALIASES = new Map<string, string>([
  ['recebimento_de_leite_cru', 'recepcao'],
  ['despacho_de_creme', 'expedicao_de_creme'],
  ['estocagem_de_pasteurizado', 'pasteurizacao'],
])

/**
 * Normaliza um nome de site para seu slug canônico de banco de dados.
 *
 * @remarks
 * Aplica {@link toAreaSlug} (limpeza e snake_case) e então consulta
 * {@link SITE_SLUG_ALIASES} para resolver aliases legados.
 * Se nenhum alias for encontrado, retorna o slug normalizado diretamente.
 *
 * @param {string} site - Nome bruto do site (ex.: `'Recebimento de Leite Cru'`).
 * @returns {string} Slug canônico do banco de dados (ex.: `'recepcao'`).
 */
function normalizeSiteSlug(site: string): string {
  const slug = toAreaSlug(site)
  return SITE_SLUG_ALIASES.get(slug) ?? slug
}

/**
 * Verifica se um objeto {@link DateParts} possui ao menos um campo definido.
 *
 * @remarks
 * Usado para determinar se o cliente especificou alguma parte da data de início
 * ou fim, ativando a lógica de composição de data em {@link buildDateFromParts}.
 *
 * @param {DateParts} parts - Partes de data a verificar.
 * @returns {boolean} `true` se qualquer campo (`year`, `month`, `day`, `hour`, `minute`) for definido.
 */
function hasAnyDatePart(parts: DateParts): boolean {
  return (
    parts.year !== undefined ||
    parts.month !== undefined ||
    parts.day !== undefined ||
    parts.hour !== undefined ||
    parts.minute !== undefined
  )
}

/**
 * Constrói um objeto `Date` a partir de partes de data/hora opcionais,
 * com suporte a fuso horário do cliente.
 *
 * @remarks
 * **Com `tzOffsetMinutes` (offset do cliente):**
 * As partes de data são interpretadas como horário local do cliente.
 * O algoritmo:
 * 1. Desloca o `defaults` para o horário local do cliente.
 * 2. Preenche campos ausentes com os valores do `defaults` deslocado.
 * 3. Constrói a data em UTC e aplica o offset inverso para obter UTC real.
 * 4. Valida que a data construída é um calendário válido (ex.: rejeita 31/02).
 *
 * **Sem `tzOffsetMinutes`:**
 * As partes são interpretadas como horário local do servidor (comportamento legado).
 * Usa `new Date(year, month-1, day, hour, minute, ...)` diretamente.
 *
 * **`endOfHour`:**
 * Quando `true`, define segundos = 59 e milissegundos = 999, tornando o limite
 * superior do intervalo inclusivo até o final do minuto/hora especificado.
 *
 * @param {DateParts} parts           - Partes de data fornecidas pelo cliente (opcionais).
 * @param {Date}      defaults        - Data de referência para preencher campos ausentes.
 * @param {string}    label           - Rótulo para mensagem de erro (ex.: `'startDate'`).
 * @param {boolean}   endOfHour       - Se `true`, configura segundos/ms no final do minuto.
 * @param {number}    [tzOffsetMinutes] - Offset do fuso horário do cliente em minutos
 *   (ex.: `-180` para BRT/UTC-3, `60` para CET/UTC+1). Válido: `[-840, 840]`.
 *
 * @returns {Date} Objeto `Date` UTC correspondente às partes informadas.
 *
 * @throws {BadRequestError} Quando as partes compõem uma data inválida no calendário
 *   (ex.: 30 de fevereiro, hora 25) ou fora do intervalo esperado.
 */
function buildDateFromParts(
  parts: DateParts,
  defaults: Date,
  label: string,
  endOfHour: boolean,
  tzOffsetMinutes?: number,
): Date {
  const hasClientOffset =
    typeof tzOffsetMinutes === 'number' && Number.isFinite(tzOffsetMinutes)

  let year: number
  let month: number
  let day: number
  let hour: number
  let minute: number
  let date: Date
  let isExactDate = false

  if (hasClientOffset) {
    /** Desloca o `defaults` para o horário local do cliente para uso como fallback. */
    const shiftedDefaults = new Date(defaults.getTime() - tzOffsetMinutes * 60 * 1000)
    year = parts.year ?? shiftedDefaults.getUTCFullYear()
    month = parts.month ?? shiftedDefaults.getUTCMonth() + 1
    day = parts.day ?? shiftedDefaults.getUTCDate()
    hour = parts.hour ?? shiftedDefaults.getUTCHours()
    minute = parts.minute ?? (endOfHour ? 59 : 0)

    date = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        endOfHour ? 59 : 0,
        endOfHour ? 999 : 0,
      ) +
        tzOffsetMinutes * 60 * 1000,
    )

    /** Valida que a data construída corresponde exatamente às partes fornecidas. */
    const shiftedDate = new Date(date.getTime() - tzOffsetMinutes * 60 * 1000)
    isExactDate =
      shiftedDate.getUTCFullYear() === year &&
      shiftedDate.getUTCMonth() === month - 1 &&
      shiftedDate.getUTCDate() === day &&
      shiftedDate.getUTCHours() === hour &&
      shiftedDate.getUTCMinutes() === minute
  } else {
    year = parts.year ?? defaults.getFullYear()
    month = parts.month ?? defaults.getMonth() + 1
    day = parts.day ?? defaults.getDate()
    hour = parts.hour ?? defaults.getHours()
    minute = parts.minute ?? (endOfHour ? 59 : 0)

    date = new Date(
      year,
      month - 1,
      day,
      hour,
      minute,
      endOfHour ? 59 : 0,
      endOfHour ? 999 : 0,
    )

    isExactDate =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day &&
      date.getHours() === hour &&
      date.getMinutes() === minute
  }

  if (!isExactDate) {
    throw new BadRequestError(`${label} is invalid`)
  }

  return date
}

/**
 * Converte uma string de variável de ambiente em booleano.
 *
 * @remarks
 * Considera `false` os valores `"0"`, `"false"` e `"no"` (case-insensitive e trimmed).
 * Qualquer outro valor não-nulo é considerado `true`.
 * Quando `value` é `undefined`, retorna `defaultValue`.
 *
 * @param {string | undefined} value        - Valor bruto da variável de ambiente.
 * @param {boolean}            defaultValue - Valor padrão quando `value` é `undefined`.
 * @returns {boolean} Valor booleano interpretado.
 */
function toBooleanEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  const normalized = value.trim().toLowerCase()
  return normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

/**
 * Converte uma string de variável de ambiente em número de porta TCP válido.
 *
 * @remarks
 * Retorna `fallback` quando:
 * - `value` é `undefined` ou vazia.
 * - O valor parseado não é inteiro positivo no intervalo (0, 65535].
 *
 * @param {string | undefined} value    - Valor bruto da variável de ambiente.
 * @param {number}             fallback - Porta padrão caso `value` seja inválida.
 * @returns {number} Porta TCP válida.
 */
function toPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return fallback
  return parsed
}

/**
 * Resolve e valida o nome de schema PostgreSQL a partir de uma variável de ambiente.
 *
 * @remarks
 * Aceita apenas identificadores válidos PostgreSQL: `[A-Za-z_][A-Za-z0-9_]*`.
 * Valores inválidos ou ausentes resultam no schema padrão `'public'`.
 *
 * @param {string | undefined} value - Valor bruto do schema (de env var).
 * @returns {string} Nome de schema válido (sem aspas, sem caracteres especiais).
 */
function resolveSchemaName(value: string | undefined): string {
  const schema = (value ?? DEFAULT_ALERTS_SCHEMA).trim()
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(schema) ? schema : DEFAULT_ALERTS_SCHEMA
}

/**
 * Normaliza o campo `recipients` retornado pelo PostgreSQL (JSONB).
 *
 * @remarks
 * O campo `recipients` (JSONB) pode ser retornado pelo driver `pg` como:
 * - `string` — JSON serializado (ex.: `'["a@b.com"]'`), necessitando parse.
 * - `string[]` — array já deserializado pelo driver.
 * - Qualquer outro tipo → retorna `[]`.
 *
 * Em caso de falha no `JSON.parse`, retorna `[]` silenciosamente.
 *
 * @param {unknown} value - Valor bruto do campo `recipients` da linha do banco.
 * @returns {string[]} Array de strings de destinatários (pode ser vazio).
 */
function parseRecipients(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return []
    }
  }

  return []
}

/**
 * Converte uma linha raw do PostgreSQL para o formato {@link LegacyAlertPayload}.
 *
 * @remarks
 * Utilizado no modo multi-DB onde o resultado vem diretamente de `pg.Client.query`,
 * sem passar pelo mapeamento do TypeORM ou pelo modelo de domínio {@link AlertsSample}.
 *
 * @param {Record<string, unknown>} row              - Linha raw retornada pelo PostgreSQL.
 * @param {string}                  fallbackClientId - `clientId` da requisição, usado quando
 *   `row.client_id` está ausente.
 * @param {string}                  fallbackSite     - Site de fallback (geralmente o slug da área).
 *
 * @returns {LegacyAlertPayload} Payload no formato compatível com o frontend legado.
 */
function rowToLegacyPayload(
  row: Record<string, unknown>,
  fallbackClientId: string,
  fallbackSite: string,
): LegacyAlertPayload {
  const tagName = String(row.tag_name ?? '')
  const timestamp = new Date(String(row.timestamp ?? '')).toISOString()

  return {
    timestamp,
    alertData: {
      [tagName]: Number(row.value ?? 0),
      AlertsCount: Number(row.alerts_count ?? 1),
      Desvio: String(row.desvio ?? 'UNKNOWN').toUpperCase(),
      Unidade: String(row.unidade ?? ''),
    },
    recipients: parseRecipients(row.recipients),
    clientId: String(row.client_id ?? fallbackClientId),
    site: String(row.site ?? fallbackSite),
  }
}

/**
 * Verifica se um erro do PostgreSQL indica que a relação (tabela) não existe.
 *
 * @remarks
 * O código de erro PostgreSQL `42P01` corresponde a `undefined_table`
 * (relação não encontrada). Usado para tratar graciosamente áreas que
 * ainda não possuem a tabela `alerts_samples` criada em seu banco.
 *
 * @param {unknown} error - Objeto de erro capturado pelo `catch`.
 * @returns {boolean} `true` se o erro for `42P01` (tabela inexistente).
 */
function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '42P01'
  )
}

/**
 * Verifica se o modo de leitura multi-banco está habilitado.
 *
 * @remarks
 * Controlado pela variável de ambiente `ALERTS_MULTI_DB_READ`.
 * **Padrão: `true`** (habilitado) — o controller consultará todos os bancos de área.
 * Desative com `ALERTS_MULTI_DB_READ=false` para usar apenas o banco principal via TypeORM.
 *
 * @returns {boolean} `true` se o modo multi-DB estiver ativo.
 */
function isMultiAreaReadEnabled(): boolean {
  return toBooleanEnabled(process.env.ALERTS_MULTI_DB_READ, true)
}

/**
 * Resolve a lista de bancos de dados de área a consultar no modo multi-DB.
 *
 * @remarks
 * **Áreas configuradas:**
 *
 * | Slug                     | Porta padrão | Env de host/porta/db                              |
 * |--------------------------|:------------:|---------------------------------------------------|
 * | `pasteurizacao`          | 5432         | `ALERTS_DB_PASTEURIZACAO_HOST/PORT/NAME`          |
 * | `utilidades`             | 5433         | `ALERTS_DB_UTILIDADES_HOST/PORT/NAME`             |
 * | `recepcao`               | 5434         | `ALERTS_DB_RECEPCAO_HOST/PORT/NAME`               |
 * | `estocagem_de_leite_cru` | 5435         | `ALERTS_DB_ESTOCAGEM_DE_LEITE_CRU_HOST/PORT/NAME` |
 * | `expedicao_de_creme`     | 5436         | `ALERTS_DB_EXPEDICAO_DE_CREME_HOST/PORT/NAME`     |
 * | `alsafe`                 | 5437         | `ALERTS_DB_ALSAFE_HOST/PORT/NAME`                 |
 *
 * **Credenciais compartilhadas:** `user` e `password` são as mesmas para todas
 * as áreas, derivadas de `ALERTS_DB_USER`/`ALERTS_DB_PASS` (ou fallbacks `DB_USER`/`DB_PASS`).
 *
 * **Filtro por site:** Quando `site` é fornecido, retorna apenas o alvo cujo
 * slug canônico corresponde ao slug normalizado do site (via {@link normalizeSiteSlug}).
 * Sem `site`, retorna todos os 6 alvos.
 *
 * @param {string} [site] - Nome bruto do site para filtrar um único banco de área.
 *   Quando omitido, todos os bancos são retornados.
 *
 * @returns {AlertsDbTarget[]} Lista de alvos de banco de dados a consultar.
 *   Pode ser vazia se `site` não corresponder a nenhuma área conhecida.
 */
function resolveAlertsAreaTargets(site?: string): AlertsDbTarget[] {
  const defaultHost = (process.env.ALERTS_DB_HOST ?? 'localhost').trim() || 'localhost'
  const schema = resolveSchemaName(process.env.ALERTS_DB_SCHEMA ?? process.env.DB_SCHEMA)
  const user = (process.env.ALERTS_DB_USER ?? process.env.DB_USER ?? DEFAULT_ALERTS_DB_USER).trim() || DEFAULT_ALERTS_DB_USER
  const password = process.env.ALERTS_DB_PASS ?? process.env.DB_PASS ?? DEFAULT_ALERTS_DB_PASS

  const targets: AlertsDbTarget[] = [
    {
      slug: 'pasteurizacao',
      host: (process.env.ALERTS_DB_PASTEURIZACAO_HOST ?? defaultHost).trim() || defaultHost,
      port: toPort(process.env.ALERTS_DB_PASTEURIZACAO_PORT, 5432),
      database: (process.env.ALERTS_DB_PASTEURIZACAO_NAME ?? 'pasteurizacao').trim() || 'pasteurizacao',
      schema,
      user,
      password,
    },
    {
      slug: 'utilidades',
      host: (process.env.ALERTS_DB_UTILIDADES_HOST ?? defaultHost).trim() || defaultHost,
      port: toPort(process.env.ALERTS_DB_UTILIDADES_PORT, 5433),
      database: (process.env.ALERTS_DB_UTILIDADES_NAME ?? 'utilidades').trim() || 'utilidades',
      schema,
      user,
      password,
    },
    {
      slug: 'recepcao',
      host: (process.env.ALERTS_DB_RECEPCAO_HOST ?? defaultHost).trim() || defaultHost,
      port: toPort(process.env.ALERTS_DB_RECEPCAO_PORT, 5434),
      database: (process.env.ALERTS_DB_RECEPCAO_NAME ?? 'recepcao').trim() || 'recepcao',
      schema,
      user,
      password,
    },
    {
      slug: 'estocagem_de_leite_cru',
      host: (process.env.ALERTS_DB_ESTOCAGEM_DE_LEITE_CRU_HOST ?? defaultHost).trim() || defaultHost,
      port: toPort(process.env.ALERTS_DB_ESTOCAGEM_DE_LEITE_CRU_PORT, 5435),
      database: (process.env.ALERTS_DB_ESTOCAGEM_DE_LEITE_CRU_NAME ?? 'estocagem_de_leite_cru').trim() || 'estocagem_de_leite_cru',
      schema,
      user,
      password,
    },
    {
      slug: 'expedicao_de_creme',
      host: (process.env.ALERTS_DB_EXPEDICAO_DE_CREME_HOST ?? defaultHost).trim() || defaultHost,
      port: toPort(process.env.ALERTS_DB_EXPEDICAO_DE_CREME_PORT, 5436),
      database: (process.env.ALERTS_DB_EXPEDICAO_DE_CREME_NAME ?? 'expedicao_de_creme').trim() || 'expedicao_de_creme',
      schema,
      user,
      password,
    },
    {
      slug: 'alsafe',
      host: (process.env.ALERTS_DB_ALSAFE_HOST ?? defaultHost).trim() || defaultHost,
      port: toPort(process.env.ALERTS_DB_ALSAFE_PORT, 5437),
      database: (process.env.ALERTS_DB_ALSAFE_NAME ?? 'alsafe').trim() || 'alsafe',
      schema,
      user,
      password,
    },
  ]

  const normalizedSite = site?.trim()
  if (!normalizedSite) {
    return targets
  }

  const requestedSlug = normalizeSiteSlug(normalizedSite)
  return targets.filter((target) => normalizeSiteSlug(target.slug) === requestedSlug)
}

/**
 * Consulta um banco de dados de área específico e retorna os alertas encontrados.
 *
 * @remarks
 * Abre uma conexão direta via `pg.Client` (independente do TypeORM),
 * executa a query parametrizada com os filtros fornecidos e fecha a conexão
 * no bloco `finally`.
 *
 * **Tratamento de erros:**
 * - Erro `42P01` (tabela não existe): retorna `[]` silenciosamente — a área
 *   pode existir mas ainda não ter alertas registrados.
 * - Outros erros: registra no console e retorna `[]` para não bloquear o merge
 *   de resultados de outras áreas que responderam com sucesso.
 *
 * @param {AlertsDbTarget}   target - Parâmetros de conexão do banco de área.
 * @param {AlertsSearchInput} input - Filtros de busca a aplicar na query.
 *
 * @returns {Promise<LegacyAlertPayload[]>}
 *   Lista de alertas da área no formato legado, ou `[]` em caso de erro.
 */
async function fetchAlertsFromTarget(
  target: AlertsDbTarget,
  input: AlertsSearchInput,
): Promise<LegacyAlertPayload[]> {
  const client = new PgClient({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
  })

  try {
    await client.connect()

    const params: unknown[] = [input.clientId]
    const conditions: string[] = ['client_id = $1']
    let index = 2

    if (input.tagName && input.tagName.trim() !== '') {
      conditions.push(`tag_name = $${index}`)
      params.push(input.tagName.trim())
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

    params.push(input.limit)

    const sql = `
      SELECT client_id, "timestamp", tag_name, value, desvio, alerts_count, unidade, recipients
      FROM ${target.schema}.alerts_samples
      WHERE ${conditions.join(' AND ')}
      ORDER BY "timestamp" DESC
      LIMIT $${index}
    `

    const result = await client.query<Record<string, unknown>>(sql, params)
    return result.rows.map(
      (row: Record<string, unknown>) =>
        rowToLegacyPayload(row, input.clientId, input.site ?? target.slug),
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      // Área sem tabela ainda — retorna vazio sem logar como erro
      return []
    }

    console.error('[alerts-sent][multi-db] area query failed', {
      area: target.slug,
      host: target.host,
      port: target.port,
      database: target.database,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  } finally {
    /** Fecha a conexão independentemente de sucesso ou falha. */
    await client.end().catch(() => undefined)
  }
}

/**
 * Consulta todas as áreas correspondentes ao filtro de site em paralelo,
 * mescla, ordena e trunca os resultados.
 *
 * @remarks
 * **Paralelismo:** Usa `Promise.all` para disparar todas as queries simultaneamente,
 * minimizando a latência total (limitada pela área mais lenta, não pela soma).
 *
 * **Merge e ordenação:** Os arrays de cada área são concatenados com `.flat()` e
 * ordenados por `timestamp` decrescente, garantindo coerência temporal global.
 *
 * **Truncamento:** Após o merge, aplica `slice(0, limit)` para respeitar o limite
 * total de registros solicitado pelo cliente.
 *
 * @param {AlertsSearchInput} input - Filtros de busca (inclui `limit` e `site` opcionais).
 * @returns {Promise<LegacyAlertPayload[]>}
 *   Lista mesclada, ordenada por `timestamp DESC` e truncada ao `limit` solicitado.
 *   Retorna `[]` quando nenhuma área corresponde ao filtro de site.
 */
async function getAlertsFromAllAreas(input: AlertsSearchInput): Promise<LegacyAlertPayload[]> {
  const targets = resolveAlertsAreaTargets(input.site)
  if (targets.length === 0) return []
  const perArea = await Promise.all(targets.map((target) => fetchAlertsFromTarget(target, input)))
  const merged = perArea.flat()

  merged.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime()
    const bTime = new Date(b.timestamp).getTime()
    return bTime - aTime
  })

  return merged.slice(0, input.limit)
}

/**
 * Handler HTTP para `GET /:clientId/alerts-sent`.
 *
 * @remarks
 * **Query params aceitos (todos opcionais exceto `clientId` via rota):**
 *
 * | Parâmetro       | Tipo     | Intervalo válido      | Descrição                             |
 * |-----------------|----------|-----------------------|---------------------------------------|
 * | `limit`         | integer  | 1–500                 | Máximo de alertas retornados          |
 * | `tagName`       | string   | 1–255 chars           | Filtro por nome de tag OPC UA         |
 * | `site`          | string   | 1–255 chars           | Filtro por nome de área/site          |
 * | `startYear`     | integer  | 1970–9999             | Ano de início                         |
 * | `startMonth`    | integer  | 1–12                  | Mês de início                         |
 * | `startDay`      | integer  | 1–31                  | Dia de início                         |
 * | `startHour`     | integer  | 0–23                  | Hora de início                        |
 * | `startMinute`   | integer  | 0–59                  | Minuto de início                      |
 * | `endYear`       | integer  | 1970–9999             | Ano de fim                            |
 * | `endMonth`      | integer  | 1–12                  | Mês de fim                            |
 * | `endDay`        | integer  | 1–31                  | Dia de fim                            |
 * | `endHour`       | integer  | 0–23                  | Hora de fim                           |
 * | `endMinute`     | integer  | 0–59                  | Minuto de fim                         |
 * | `tzOffsetMinutes` | integer | −840 a +840          | Offset UTC do cliente em minutos      |
 *
 * **Lógica de intervalo temporal:**
 * - Sem partes → `[agora − 1h, agora]`
 * - Só start → `[start, start + 1h]`
 * - Só end → `[end − 1h, end]`
 * - Ambos → `[start, end]`
 *
 * **Resposta (`200 OK`):** Array de {@link LegacyAlertPayload} em JSON.
 *
 * @param {Request}  request  - Requisição Express.
 *   - `request.params.clientId` — identificador do cliente OPC UA (obrigatório).
 *   - `request.query` — parâmetros de filtro e intervalo temporal.
 * @param {Response} response - Resposta Express.
 *
 * @returns {Promise<Response>}
 *   `200 OK` com array JSON de {@link LegacyAlertPayload}.
 *
 * @throws Erros de validação Zod são capturados e tratados pelo middleware global.
 * @throws {BadRequestError} Quando partes de data compõem data inválida.
 */
export async function getAlertsSentController(
  request: Request,
  response: Response,
): Promise<Response> {
  const clientId = request.params.clientId as string

  /** Schema Zod para validação e coerção dos query params. */
  const querySchema = z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
    tagName: z.string().trim().min(1).max(255).optional(),
    site: z.string().trim().min(1).max(255).optional(),
    startYear: z.coerce.number().int().min(1970).max(9999).optional(),
    startMonth: z.coerce.number().int().min(1).max(12).optional(),
    startDay: z.coerce.number().int().min(1).max(31).optional(),
    startHour: z.coerce.number().int().min(0).max(23).optional(),
    startMinute: z.coerce.number().int().min(0).max(59).optional(),
    endYear: z.coerce.number().int().min(1970).max(9999).optional(),
    endMonth: z.coerce.number().int().min(1).max(12).optional(),
    endDay: z.coerce.number().int().min(1).max(31).optional(),
    endHour: z.coerce.number().int().min(0).max(23).optional(),
    endMinute: z.coerce.number().int().min(0).max(59).optional(),
    tzOffsetMinutes: z.coerce.number().int().min(-MAX_TZ_OFFSET_MINUTES).max(MAX_TZ_OFFSET_MINUTES).optional(),
  })

  const {
    limit,
    tagName,
    site,
    startYear,
    startMonth,
    startDay,
    startHour,
    startMinute,
    endYear,
    endMonth,
    endDay,
    endHour,
    endMinute,
    tzOffsetMinutes,
  } = dataValidation(querySchema, request.query)

  const now = new Date()
  const startParts: DateParts = {
    year: startYear,
    month: startMonth,
    day: startDay,
    hour: startHour,
    minute: startMinute,
  }
  const endParts: DateParts = {
    year: endYear,
    month: endMonth,
    day: endDay,
    hour: endHour,
    minute: endMinute,
  }
  const hasStartParts = hasAnyDatePart(startParts)
  const hasEndParts = hasAnyDatePart(endParts)

  let startDate: Date
  let endDate: Date

  if (!hasStartParts && !hasEndParts) {
    /** Nenhuma parte fornecida → janela padrão da última hora. */
    endDate = now
    startDate = new Date(now.getTime() - ONE_HOUR_MS)
  } else if (hasStartParts && !hasEndParts) {
    /** Apenas start → end = start + 1 hora. */
    startDate = buildDateFromParts(startParts, now, 'startDate', false, tzOffsetMinutes)
    endDate = new Date(startDate.getTime() + ONE_HOUR_MS)
  } else if (!hasStartParts && hasEndParts) {
    /** Apenas end → start = end − 1 hora. */
    endDate = buildDateFromParts(endParts, now, 'endDate', true, tzOffsetMinutes)
    startDate = new Date(endDate.getTime() - ONE_HOUR_MS)
  } else {
    /** Ambos fornecidos → usa exatamente os valores calculados. */
    startDate = buildDateFromParts(startParts, now, 'startDate', false, tzOffsetMinutes)
    endDate = buildDateFromParts(endParts, now, 'endDate', true, tzOffsetMinutes)
  }

  const useCase = container.resolve<GetAlertsSentUseCase>('GetAlertsSentUseCase')
  const effectiveLimit = limit ?? DEFAULT_ALERTS_LIMIT

  if (isMultiAreaReadEnabled()) {
    const alerts = await getAlertsFromAllAreas({
      clientId,
      limit: effectiveLimit,
      tagName,
      site,
      startDate,
      endDate,
    })
    return response.status(200).json(alerts)
  }

  /** Modo single-DB: delega ao caso de uso e converte para formato legado. */
  const alerts = await useCase.execute({
    clientId,
    limit: effectiveLimit,
    tagName,
    site,
    startDate,
    endDate,
  })

  return response.status(200).json(alerts.map((alert) => alert.toLegacyPayload()))
}
