/* eslint-disable prettier/prettier */

/**
 * @file get-alerts-sent.usecase.ts
 * @description
 * Caso de uso responsável por recuperar alertas já enviados/persistidos,
 * com suporte a múltiplos filtros opcionais (tag, site, intervalo temporal)
 * e controle de limite máximo de resultados.
 *
 * @module alerts/app/usecases/get-alerts-sent
 */

import { BadRequestError } from '../../../common/domain/errors/bad-request-error.js'
import { AlertsRepositoryInterface } from '../../domain/repositories/AlertsRepository.js'
import { AlertsSample } from '../../domain/models/AlertsSample.js'

/**
 * Parâmetros de entrada para a consulta de alertas enviados.
 *
 * @remarks
 * Apenas `clientId` é obrigatório. Todos os demais campos são filtros opcionais.
 * Quando `startDate` e `endDate` são fornecidos simultaneamente, `startDate`
 * deve ser anterior ou igual a `endDate`; caso contrário, um {@link BadRequestError}
 * é lançado em {@link GetAlertsSentUseCase.execute}.
 *
 * @property {string} clientId
 *   Identificador único do cliente OPC UA. Obrigatório e não pode ser vazio.
 *
 * @property {number} [limit]
 *   Quantidade máxima de alertas a retornar. Padrão: `100` quando omitido.
 *
 * @property {string} [tagName]
 *   Filtro opcional pelo nome exato da tag OPC UA (ex.: `'TEMP_REACTOR_01'`).
 *   Espaços extras nas extremidades são removidos automaticamente.
 *
 * @property {string} [site]
 *   Filtro opcional pelo nome do site/planta (ex.: `'Unidade-SP'`).
 *   Espaços extras nas extremidades são removidos automaticamente.
 *
 * @property {Date} [startDate]
 *   Início do intervalo temporal de busca (inclusivo). Opcional.
 *
 * @property {Date} [endDate]
 *   Fim do intervalo temporal de busca (inclusivo). Opcional.
 */
export type GetAlertsSentInput = {
  clientId: string
  limit?: number
  tagName?: string
  site?: string
  startDate?: Date
  endDate?: Date
}

/**
 * Caso de uso: Recuperar alertas enviados com filtros opcionais.
 *
 * @remarks
 * **Responsabilidades:**
 * 1. Sanitizar e validar `clientId` (trim + verificação de vazio).
 * 2. Validar consistência do intervalo temporal: `startDate` deve ser ≤ `endDate`
 *    quando ambos forem fornecidos.
 * 3. Normalizar os filtros opcionais (`tagName`, `site`): remove espaços extras
 *    e converte strings vazias em `undefined` para evitar filtros ineficazes.
 * 4. Aplicar o limite padrão de **100 registros** quando `limit` não for informado.
 * 5. Delegar ao repositório a busca filtrada via `findByFilters`.
 *
 * **Integração:** Normalmente invocado por um controller HTTP
 * (ex.: `GET /alerts/sent?clientId=...&tagName=...&startDate=...`).
 *
 * @example
 * ```typescript
 * const useCase = new GetAlertsSentUseCase(alertsRepository);
 *
 * const alerts = await useCase.execute({
 *   clientId: 'plant-A',
 *   tagName: 'TEMP_REACTOR_01',
 *   startDate: new Date('2025-01-01'),
 *   endDate: new Date('2025-01-31'),
 *   limit: 50,
 * });
 *
 * console.log(`${alerts.length} alertas encontrados.`);
 * alerts.forEach(a => console.log(a.id, a.desvio, a.value));
 * ```
 */
export class GetAlertsSentUseCase {
  /**
   * Cria uma nova instância do caso de uso.
   *
   * @param {AlertsRepositoryInterface} alertsRepository - Repositório de alertas
   *   utilizado para executar a consulta filtrada.
   */
  constructor(
    private readonly alertsRepository: AlertsRepositoryInterface,
  ) {}

  /**
   * Executa a consulta de alertas enviados com os filtros fornecidos.
   *
   * @param {GetAlertsSentInput} input - Parâmetros de consulta.
   * @param {string} input.clientId
   *   Identificador do cliente OPC UA. Obrigatório; não pode ser vazio após trim.
   * @param {number} [input.limit=100]
   *   Quantidade máxima de resultados retornados. Padrão: `100`.
   * @param {string} [input.tagName]
   *   Filtro por nome de tag OPC UA (espaços extras são removidos; string vazia é ignorada).
   * @param {string} [input.site]
   *   Filtro por site/planta (espaços extras são removidos; string vazia é ignorada).
   * @param {Date} [input.startDate]
   *   Data inicial do intervalo (inclusiva). Deve ser ≤ `endDate` quando ambas são fornecidas.
   * @param {Date} [input.endDate]
   *   Data final do intervalo (inclusiva). Deve ser ≥ `startDate` quando ambas são fornecidas.
   *
   * @returns {Promise<AlertsSample[]>}
   *   Lista de entidades {@link AlertsSample} que satisfazem os filtros informados,
   *   ordenadas pelo repositório (geralmente por `timestamp` decrescente).
   *   Retorna array vazio quando nenhum alerta atende aos critérios.
   *
   * @throws {BadRequestError}
   *   Quando `clientId` está vazio ou é composto apenas de espaços em branco.
   * @throws {BadRequestError}
   *   Quando `startDate` é posterior a `endDate`.
   */
  async execute(input: GetAlertsSentInput): Promise<AlertsSample[]> {
    /** `clientId` sanitizado (trim); validado logo abaixo. */
    const clientId = input.clientId?.trim()
    if (!clientId) {
      throw new BadRequestError('clientId is required')
    }

    if (input.startDate && input.endDate && input.startDate > input.endDate) {
      throw new BadRequestError('startDate must be less than or equal to endDate')
    }

    return this.alertsRepository.findByFilters({
      clientId,
      limit: input.limit ?? 100,
      tagName: input.tagName?.trim() || undefined,
      site: input.site?.trim() || undefined,
      startDate: input.startDate,
      endDate: input.endDate,
    })
  }
}
