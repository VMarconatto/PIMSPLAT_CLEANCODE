/* eslint-disable prettier/prettier */

/**
 * @file get-alerts-summary.usecase.ts
 * @description
 * Caso de uso responsável por retornar um resumo agregado dos alertas
 * de um cliente específico, incluindo totais, distribuição por nível
 * de desvio e por tag, além do timestamp do último alerta registrado.
 *
 * @module alerts/app/usecases/get-alerts-summary
 */

import { BadRequestError } from '../../../common/domain/errors/bad-request-error.js'
import { AlertSummaryOutput } from '../../../common/domain/repositories/repository.interface.js'
import { AlertsRepositoryInterface } from '../../domain/repositories/AlertsRepository.js'

/**
 * Caso de uso: Obter resumo agregado de alertas por cliente.
 *
 * @remarks
 * **Responsabilidades:**
 * 1. Validar que `clientId` é uma string não vazia (após trim).
 * 2. Delegar ao repositório a consulta de agregação via `summarizeByClient`.
 *
 * **Resultado:** Retorna um objeto {@link AlertSummaryOutput} com:
 * - `clientId` — identificador do cliente consultado.
 * - `total` — quantidade total de alertas registrados para o cliente.
 * - `byLevel` — mapa `{ nível → contagem }` agrupado por nível de desvio
 *   (`'LL'`, `'L'`, `'H'`, `'HH'`, `'UNKNOWN'`).
 * - `byTag` — mapa `{ tagName → contagem }` agrupado por nome de tag OPC UA.
 * - `lastTimestamp` — string ISO 8601 do alerta mais recente,
 *   ou `null` se não houver alertas registrados.
 *
 * **Integração:** Normalmente invocado por um controller HTTP
 * (ex.: `GET /alerts/summary?clientId=plant-A`).
 *
 * @example
 * ```typescript
 * const useCase = new GetAlertsSummaryUseCase(alertsRepository);
 *
 * const summary = await useCase.execute('plant-A');
 *
 * console.log(summary.total);           // ex.: 42
 * console.log(summary.byLevel);         // ex.: { HH: 10, H: 20, L: 8, LL: 4 }
 * console.log(summary.byTag);           // ex.: { TEMP_01: 15, PRESS_02: 27 }
 * console.log(summary.lastTimestamp);   // ex.: "2025-01-15T10:30:00.000Z"
 * ```
 */
export class GetAlertsSummaryUseCase {
  /**
   * Cria uma nova instância do caso de uso.
   *
   * @param {AlertsRepositoryInterface} alertsRepository - Repositório de alertas
   *   utilizado para consultar os dados agregados do cliente.
   */
  constructor(
    private readonly alertsRepository: AlertsRepositoryInterface,
  ) {}

  /**
   * Executa a consulta de resumo de alertas para um cliente.
   *
   * @param {string} clientId - Identificador único do cliente OPC UA.
   *   Não pode ser vazio ou composto apenas de espaços em branco.
   *
   * @returns {Promise<AlertSummaryOutput>}
   *   Objeto com o resumo agregado dos alertas: total geral, contagem por nível
   *   de desvio, contagem por tag e timestamp ISO 8601 do último alerta.
   *
   * @throws {BadRequestError}
   *   Quando `clientId` é vazio, nulo ou composto apenas de espaços em branco.
   */
  async execute(clientId: string): Promise<AlertSummaryOutput> {
    if (!clientId || clientId.trim() === '') {
      throw new BadRequestError('clientId is required')
    }

    return this.alertsRepository.summarizeByClient(clientId)
  }
}
