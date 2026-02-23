/* eslint-disable prettier/prettier */

/**
 * @file AlertsRepository.ts
 * @description
 * Contratos de domínio específicos do módulo **Alerts**: tipos de entrada para
 * criação e busca de alertas, e a interface de repositório que implementações
 * de infraestrutura devem satisfazer.
 *
 * @remarks
 * Em Clean Architecture, este arquivo pertence à camada de **Domínio** e define
 * as abstrações que a camada de **Aplicação** (casos de uso) consome, sem depender
 * de detalhes de infraestrutura (TypeORM, PostgreSQL, etc.).
 *
 * **Hierarquia de contratos:**
 * ```
 * IAlertsRepository<Model, CreateProps>   ← common/domain/repositories/repository.interface.ts
 *   ↑ extends
 * AlertsRepositoryInterface               ← este arquivo
 *   ↑ implements
 * AlertsTypeormRepository                 ← alerts/infrastructure/typeorm/repositories/
 * ```
 *
 * **Tipos exportados:**
 * - {@link CreateAlertInput} — payload para inserção de um novo alerta.
 * - {@link SearchAlertsInput} — parâmetros para busca filtrada de alertas.
 * - {@link AlertsRepositoryInterface} — contrato completo do repositório de alertas.
 *
 * @module alerts/domain/repositories/AlertsRepository
 */

import {
  IAlertsRepository,
  AlertSummaryOutput,
} from '../../../common/domain/repositories/repository.interface.js'
import { AlertsSample, AlertLevel } from '../models/AlertsSample.js'

/**
 * Dados necessários para inserir um novo alerta no repositório.
 *
 * @remarks
 * Utilizado como payload pelos casos de uso {@link ProcessAlertsUseCase} e
 * diretamente pelo repositório em `insert` e `insertIfNotRecent`.
 *
 * O campo `timestamp` aceita tanto `string` ISO 8601 quanto objeto `Date`
 * para flexibilidade no consumo de mensagens RabbitMQ (que chegam como JSON).
 *
 * @property {string | Date} timestamp
 *   Data/hora em que o alerta foi gerado pelo sistema OPC UA.
 *   Aceita string ISO 8601 (`"2025-01-15T10:30:00.000Z"`) ou objeto `Date`.
 *
 * @property {string} clientId
 *   Identificador único do cliente OPC UA que originou o alerta.
 *
 * @property {string} [site]
 *   Nome do site/planta industrial de onde o alerta foi emitido. Opcional.
 *   Armazenado como string vazia quando ausente.
 *
 * @property {string} tagName
 *   Nome da tag OPC UA monitorada que ultrapassou o limite configurado
 *   (ex.: `'TEMP_REACTOR_01'`, `'PRESS_OUT_PT02'`).
 *
 * @property {number} value
 *   Valor numérico lido da tag no momento do disparo do alerta.
 *
 * @property {AlertLevel} desvio
 *   Nível de desvio classificado pelo sistema de alarmes.
 *   Valores válidos: `'LL'` | `'L'` | `'H'` | `'HH'` | `'UNKNOWN'`.
 *
 * @property {number} alertsCount
 *   Contador acumulado de disparos de alerta para esta tag desde o último reset.
 *
 * @property {string} unidade
 *   Unidade de engenharia do valor medido (ex.: `'°C'`, `'bar'`, `'m³/h'`).
 *   Armazenada como string vazia quando não disponível.
 *
 * @property {string[]} recipients
 *   Lista de destinatários (e-mails ou identificadores) a serem notificados.
 *   Pode ser um array vazio quando não há destinatários configurados.
 */
export type CreateAlertInput = {
  timestamp: string | Date
  clientId: string
  site?: string
  tagName: string
  value: number
  desvio: AlertLevel
  alertsCount: number
  unidade: string
  recipients: string[]
}

/**
 * Parâmetros de entrada para busca filtrada de alertas no repositório.
 *
 * @remarks
 * Utilizado por {@link AlertsRepositoryInterface.findByFilters} e repassado
 * internamente pelo caso de uso {@link GetAlertsSentUseCase}.
 *
 * Apenas `clientId` é obrigatório. Os demais campos são filtros opcionais
 * que, quando fornecidos, restringem os resultados retornados.
 *
 * Quando `startDate` e `endDate` são ambos fornecidos, `startDate` deve ser
 * anterior ou igual a `endDate`; a validação desta regra é responsabilidade
 * do caso de uso, não do repositório.
 *
 * @property {string} clientId
 *   Identificador único do cliente OPC UA. Obrigatório.
 *
 * @property {number} [limit]
 *   Número máximo de alertas a retornar.
 *   O repositório aplica um valor padrão (ex.: 100) quando omitido e
 *   clampeia o valor máximo (ex.: 500) para proteção contra queries irrestringidas.
 *
 * @property {string} [tagName]
 *   Filtro exato pelo nome da tag OPC UA. Espaços extras são ignorados.
 *
 * @property {string} [site]
 *   Filtro exato pelo nome do site/planta. Espaços extras são ignorados.
 *
 * @property {Date} [startDate]
 *   Início do intervalo temporal de busca (inclusivo).
 *   Filtra registros com `timestamp >= startDate`.
 *
 * @property {Date} [endDate]
 *   Fim do intervalo temporal de busca (inclusivo).
 *   Filtra registros com `timestamp <= endDate`.
 */
export type SearchAlertsInput = {
  clientId: string
  limit?: number
  tagName?: string
  site?: string
  startDate?: Date
  endDate?: Date
}

/**
 * Contrato completo do repositório de alertas do módulo Alerts.
 *
 * @remarks
 * Estende {@link IAlertsRepository}`<`{@link AlertsSample}`, `{@link CreateAlertInput}`>`
 * herdando os métodos base:
 * - `insert(props)` — inserção incondicional.
 * - `insertIfNotRecent(props, dedupWindowMs)` — inserção com deduplicação temporal.
 * - `findLatestByClient(clientId, limit?)` — busca dos alertas mais recentes.
 * - `summarizeByClient(clientId)` — agregação por cliente (já especializada abaixo).
 *
 * E adiciona dois métodos específicos do módulo:
 * - `findByFilters` — busca com múltiplos filtros opcionais.
 * - `summarizeByClient` — sobrescrita com assinatura tipada.
 *
 * **Implementação concreta:** {@link AlertsTypeormRepository}
 * (em `alerts/infrastructure/typeorm/repositories/`).
 *
 * @extends IAlertsRepository<AlertsSample, CreateAlertInput>
 *
 * @example
 * ```typescript
 * // Em um caso de uso:
 * constructor(private readonly alertsRepository: AlertsRepositoryInterface) {}
 *
 * // Busca filtrada:
 * const alerts = await this.alertsRepository.findByFilters({
 *   clientId: 'plant-A',
 *   tagName: 'TEMP_REACTOR_01',
 *   startDate: new Date('2025-01-01'),
 *   endDate: new Date('2025-01-31'),
 *   limit: 50,
 * })
 *
 * // Resumo agregado:
 * const summary = await this.alertsRepository.summarizeByClient('plant-A')
 * console.log(summary.total, summary.byLevel, summary.lastTimestamp)
 * ```
 */
export interface AlertsRepositoryInterface
  extends IAlertsRepository<AlertsSample, CreateAlertInput> {
  /**
   * Busca alertas com suporte a múltiplos filtros opcionais.
   *
   * @remarks
   * Os filtros de `tagName` e `site` aplicam correspondência exata (não parcial).
   * Os filtros de data aplicam comparação inclusiva nos dois extremos do intervalo.
   * O repositório garante que o `limit` seja aplicado e que os resultados sejam
   * ordenados por `timestamp` decrescente (mais recentes primeiro).
   *
   * @param {SearchAlertsInput} input - Parâmetros de busca com `clientId` obrigatório
   *   e demais filtros opcionais.
   *
   * @returns {Promise<AlertsSample[]>}
   *   Array de entidades {@link AlertsSample} que satisfazem os filtros,
   *   ordenado por `timestamp DESC`. Retorna `[]` quando nenhum registro é encontrado.
   */
  findByFilters(input: SearchAlertsInput): Promise<AlertsSample[]>

  /**
   * Retorna o resumo agregado de alertas de um cliente.
   *
   * @remarks
   * Agrega os dados em três dimensões:
   * - **Total geral:** contagem de todos os alertas do cliente.
   * - **Por nível (`byLevel`):** mapa `{ desvio → contagem }` agrupado por {@link AlertLevel}.
   * - **Por tag (`byTag`):** mapa `{ tagName → contagem }` agrupado por nome de tag.
   * - **Último timestamp:** ISO 8601 do alerta mais recente, ou `null` se não houver alertas.
   *
   * @param {string} clientId - Identificador único do cliente OPC UA.
   *
   * @returns {Promise<AlertSummaryOutput>}
   *   Objeto com `clientId`, `total`, `byLevel`, `byTag` e `lastTimestamp`.
   */
  summarizeByClient(clientId: string): Promise<AlertSummaryOutput>
}
