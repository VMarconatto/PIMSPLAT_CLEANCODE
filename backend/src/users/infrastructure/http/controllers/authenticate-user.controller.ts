/* eslint-disable prettier/prettier */
import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { z } from 'zod'
import { dataValidation } from '../../../../common/infrastructure/validation/zod/index.js'
import { AuthenticateUserUseCase } from '../../../application/usecases/authenticate-user.usecase.js'
import { IAuthProvider } from '../../../../common/domain/providers/auth-provider.js'

/**
 * @fileoverview Authenticate User Controller (HTTP)
 *
 * Controller responsável pelo endpoint de autenticação (login).
 *
 * ## Responsabilidade (Infrastructure / HTTP)
 * - Validar entrada (Zod)
 * - Resolver o use case via DI (tsyringe)
 * - Executar autenticação (email/senha)
 * - Gerar chave/token de acesso via `IAuthProvider`
 * - Retornar a resposta HTTP
 *
 * ## Importante
 * Este controller **não implementa regras de autenticação**.
 * Ele apenas orquestra chamadas para:
 * - `AuthenticateUserUseCase` (application)
 * - `IAuthProvider` (provider de autenticação: JWT, session, etc.)
 */

/**
 * Realiza autenticação do usuário e retorna um `access_token`.
 *
 * ## Entrada (body)
 * - `email`: string (validado como email)
 * - `password`: string
 *
 * ## Saída
 * - **200 OK** com `{ access_token }`
 *
 * ## Dependências resolvidas por DI
 * - `'AuthenticateUserUseCase'`
 * - `'IAuthProvider'`
 *
 * @param request - Request Express contendo credenciais no body.
 * @param response - Response Express.
 * @returns Response com status 200 e o token de acesso.
 */
export async function authenticateUserController(
  request: Request,
  response: Response,
): Promise<Response> {
  const bodySchema = z.object({
    email: z.string().email(),
    password: z.string(),
  })
  const { email, password } = dataValidation(bodySchema, request.body)

  const authenticateUserUseCase: AuthenticateUserUseCase.UseCase =
    container.resolve('AuthenticateUserUseCase')

  const user = await authenticateUserUseCase.execute({
    email,
    password,
  })

  const authProvider: IAuthProvider = container.resolve('IAuthProvider')

  const { access_token } = authProvider.generateAuthKey(user.id)

  return response.status(200).json({ access_token })
}
