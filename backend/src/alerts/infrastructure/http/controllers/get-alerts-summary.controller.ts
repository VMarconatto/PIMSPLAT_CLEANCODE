/* eslint-disable prettier/prettier */

/**
 * @file get-alerts-summary.controller.ts
 * @description
 * Controller HTTP responsável por tratar requisições `GET /:clientId/alerts-summary`,
 * delegando ao caso de uso {@link GetAlertsSummaryUseCase} e retornando o
 * resumo agregado de alertas do cliente em formato JSON.
 *
 * @module alerts/infrastructure/http/controllers/get-alerts-summary
 */

import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { GetAlertsSummaryUseCase } from '../../../app/usecases/get-alerts-summary.usecase.js'

/**
 * Handler HTTP para `GET /:clientId/alerts-summary`.
 *
 * @remarks
 * **Fluxo:**
 * 1. Extrai `clientId` do parâmetro de rota.
 * 2. Resolve `GetAlertsSummaryUseCase` do container DI (tsyringe).
 * 3. Executa o caso de uso e retorna o resultado com status `200 OK`.
 *
 * **Validação:** Realizada internamente pelo caso de uso; quando `clientId`
 * estiver vazio, um `BadRequestError` será lançado e capturado pelo
 * middleware de erros global do Express.
 *
 * **Resposta (`200 OK`):**
 * ```json
 * {
 *   "clientId": "plant-A",
 *   "total": 42,
 *   "byLevel": { "HH": 10, "H": 20, "L": 8, "LL": 4 },
 *   "byTag": { "TEMP_01": 15, "PRESS_02": 27 },
 *   "lastTimestamp": "2025-01-15T10:30:00.000Z"
 * }
 * ```
 *
 * @param {Request}  request  - Objeto de requisição Express.
 *   - `request.params.clientId` — identificador do cliente OPC UA (obrigatório).
 * @param {Response} response - Objeto de resposta Express.
 *
 * @returns {Promise<Response>}
 *   Resposta HTTP `200 OK` com o objeto {@link AlertSummaryOutput} serializado em JSON.
 *
 * @throws Erros propagados pelo caso de uso são tratados pelo middleware global de erros.
 */
export async function getAlertsSummaryController(
  request: Request,
  response: Response,
): Promise<Response> {
  const clientId = request.params.clientId as string

  const useCase = container.resolve<GetAlertsSummaryUseCase>('GetAlertsSummaryUseCase')
  const summary = await useCase.execute(clientId)

  return response.status(200).json(summary)
}
