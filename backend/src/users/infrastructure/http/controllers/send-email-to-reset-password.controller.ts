/* eslint-disable prettier/prettier */
import { dataValidation } from '../../../../common/infrastructure/validation/zod/index.js'
import { SendEmailToResetPasswordUseCase } from '../../../application/usecases/send-email-to-reset-password.usecase.js'
import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { z } from 'zod'
// TODO: implementar sendMailToResetPassword com nodemailer
// import { sendMailToResetPassword } from '../../../../common/infrastructure/config/email/nodemailer/sendMailToResetPassword.js'

/**
 * @fileoverview Send Email To Reset Password Controller (HTTP)
 *
 * Controller responsável por iniciar o fluxo de reset de senha:
 * - valida e-mail recebido
 * - solicita ao use case a geração do token
 * - dispara o envio de e-mail (infra: nodemailer)
 *
 * ## Separação de responsabilidades (nota importante)
 * Apesar do nome, o **use case** aqui retorna `{ user, token }`.
 * O envio real do e-mail ocorre neste controller através de `sendMailToResetPassword`,
 * que é um detalhe de infraestrutura.
 */

/**
 * Gera token de reset e envia e-mail para o usuário.
 *
 * ## Entrada (body)
 * - `email`: string (email válido)
 *
 * ## Saída
 * - **204 No Content**
 *
 * @param request - Request Express com `email` no body.
 * @param response - Response Express.
 * @returns Response com status 204.
 */
export async function sendEmailToResetPasswordController(
  request: Request,
  response: Response,
): Promise<Response> {
  const paramsSchema = z.object({
    email: z.string().email(),
  })
  const { email } = dataValidation(paramsSchema, request.body)

  const sendEmailToResetPasswordUseCase: SendEmailToResetPasswordUseCase.UseCase =
    container.resolve('SendEmailToResetPasswordUseCase')

  const { user, token } = await sendEmailToResetPasswordUseCase.execute({
    email,
  })

  // TODO: descomentar quando implementar sendMailToResetPassword
  // await sendMailToResetPassword({ user, token })
  console.log('Reset password token generated for:', user.email, 'token:', token)

  return response.status(204).json()
}
