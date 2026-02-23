/* eslint-disable prettier/prettier */
import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { z } from 'zod'
import { dataValidation } from '../../../../common/infrastructure/validation/zod/index.js'
import { SearchUserUseCase } from '../../../application/usecases/search-user.usecase.js'

/**
 * @fileoverview Search User Controller (HTTP)
 *
 * Controller responsável por expor a busca/listagem paginada de usuários.
 *
 * ## Responsabilidades
 * - Parse + validação de query params (Zod)
 * - Aplicar defaults (page/per_page, sort/sort_dir, filter)
 * - Delegar regras e execução da busca ao `SearchUserUseCase`
 *
 * O controller não implementa paginação nem filtro diretamente.
 */

/**
 * Busca usuários com paginação, ordenação e filtro.
 *
 * ## Entrada (query)
 * - `page?`: number (coerção de string -> number)
 * - `per_page?`: number
 * - `sort?`: string
 * - `sort_dir?`: string
 * - `filter?`: string
 *
 * ## Defaults enviados ao use case
 * - page: 1
 * - per_page: 15
 * - sort: null
 * - sort_dir: null
 * - filter: null
 *
 * ## Saída
 * - **200 OK** com o resultado paginado
 *
 * @param request - Request Express (query params).
 * @param response - Response Express.
 * @returns Response com status 200 e resultado paginado.
 */
export async function searchUserController(
  request: Request,
  response: Response,
): Promise<Response> {
  const querySchema = z.object({
    page: z.coerce.number().optional(),
    per_page: z.coerce.number().optional(),
    sort: z.string().optional(),
    sort_dir: z.string().optional(),
    filter: z.string().optional(),
  })
  const { page, per_page, sort, sort_dir, filter } = dataValidation(
    querySchema,
    request.query,
  )

  const searchUserUseCase: SearchUserUseCase.UseCase =
    container.resolve('SearchUserUseCase')

  const users = await searchUserUseCase.execute({
    page: page ?? 1,
    per_page: per_page ?? 15,
    sort: sort ?? null,
    sort_dir: sort_dir ?? null,
    filter: filter ?? null,
  })

  return response.status(200).json(users)
}
