/* eslint-disable prettier/prettier */
import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { GetHostMetricsUseCase } from '../../../app/usecases/get-host-metrics.js'

export async function getHostMetricsController(
  _request: Request,
  response: Response,
): Promise<Response> {
  const useCase = container.resolve<GetHostMetricsUseCase>('GetHostMetricsUseCase')
  const snapshot = await useCase.execute()

  return response.status(200).json({
    status: 'ok',
    snapshot,
  })
}
