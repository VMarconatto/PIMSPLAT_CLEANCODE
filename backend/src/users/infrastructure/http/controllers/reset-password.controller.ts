/* eslint-disable prettier/prettier */
import { dataValidation } from '../../../../common/infrastructure/validation/zod/index.js'
import { ResetPasswordUseCase } from '../../../application/usecases/reset-password.usecase.js'
import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { z } from 'zod'

/**
 * @fileoverview Reset Password Controller (HTTP)
 *
 * Controller responsável por finalizar o fluxo de recuperação de senha.
 *
 * ## Contexto do fluxo
 * 1) Usuário solicita reset (send-email-to-reset-password)
 * 2) Sistema gera token e envia por e-mail
 * 3) Usuário chama este endpoint com `token` + `password`
 * 4) Use case valida token/expiração e atualiza a senha
 */

/**
 * Redefine a senha do usuário a partir de um token.
 *
 * ## Entrada (body)
 * - `token`: UUID
 * - `password`: string
 *
 * ## Saída
 * - **204 No Content**
 *
 * @param request - Request Express com token e nova senha no body.
 * @param response - Response Express.
 * @returns Response com status 204.
 */
export async function resetPasswordController(
  request: Request,
  response: Response,
): Promise<Response> {
  const bodySchema = z.object({
    token: z.string().uuid(),
    password: z.string(),
  })
  const { token, password } = dataValidation(bodySchema, request.body)

  const resetPasswordUseCase: ResetPasswordUseCase.UseCase = container.resolve(
    'ResetPasswordUseCase',
  )

  await resetPasswordUseCase.execute({ token, password })

  return response.status(204).json()
}
