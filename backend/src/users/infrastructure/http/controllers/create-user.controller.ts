/* eslint-disable prettier/prettier */
import { Request, Response } from 'express'
import { dataValidation } from '../../../../common/infrastructure/validation/zod/index.js'
import { CreateUserUseCase } from '../../../application/usecases/create-user.usecase.js'
import { container } from 'tsyringe'
import { z } from 'zod'

/**
 * @fileoverview Create User Controller (HTTP)
 *
 * Controller responsável por expor via HTTP o caso de uso `CreateUserUseCase`.
 *
 * ## Papel na arquitetura
 * - Recebe dados via HTTP
 * - Valida formato (Zod)
 * - Resolve o use case via DI
 * - Retorna resultado com status adequado
 *
 * Regra de negócio (hash, conflito de email, etc.) pertence ao use case.
 */

/**
 * Cria um novo usuário.
 *
 * ## Entrada (body)
 * - `name`: string
 * - `email`: string (email válido)
 * - `password`: string
 *
 * ## Saída
 * - **201 Created** com o usuário criado
 *
 * @param request - Request Express com dados de cadastro no body.
 * @param response - Response Express.
 * @returns Response com status 201 e payload do usuário criado.
 */
export async function createUserController(
  request: Request,
  response: Response,
): Promise<Response> {
  const bodySchema = z.object({
    name: z.string(),
    email: z.string().email(),
    password: z.string(),
  })

  const { name, email, password } = dataValidation(bodySchema, request.body)

  const createUserUseCase: CreateUserUseCase.UseCase =
    container.resolve('CreateUserUseCase')

  const user = await createUserUseCase.execute({
    name,
    email,
    password,
  })

  return response.status(201).json(user)
}
