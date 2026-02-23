/* eslint-disable prettier/prettier */
import { dataValidation } from '../../../../common/infrastructure/validation/zod/index.js'
import { UpdateUserUseCase } from '../../../application/usecases/update-user.usecase.js'
import { instanceToInstance } from 'class-transformer'
import { Request, Response } from 'express'
import { container } from 'tsyringe'
import { z } from 'zod'

/**
 * @fileoverview Update User Controller (HTTP)
 *
 * Controller responsável por atualizar dados do usuário autenticado.
 *
 * ## Segurança / Autenticação
 * Assim como `getUserController`, este controller depende de middleware anterior que
 * popula `request.user`. Sem isso, retorna 401.
 *
 * ## Validação com Zod + refine
 * O schema do body usa `refine` para garantir a regra:
 * - se `password` for enviado, `old_password` é obrigatório
 *
 * Essa validação no controller evita chamadas inválidas ao use case.
 * Ainda assim, o use case também contém validações defensivas do mesmo cenário.
 */

/**
 * Atualiza perfil do usuário e opcionalmente altera senha.
 *
 * ## Entrada (body)
 * - `name`: string
 * - `email`: string (email válido)
 * - `password?`: string
 * - `old_password?`: string (obrigatório se `password` existir)
 *
 * ## Saída
 * - **200 OK** com usuário atualizado (transformado por `instanceToInstance`)
 * - **401 Unauthorized** se `request.user` não existir
 *
 * @param request - Request Express (requer `request.user.id`).
 * @param response - Response Express.
 * @returns Response com status 200 e o usuário atualizado, ou 401 se não autenticado.
 */
export async function updateUserController(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!request.user) {
    return response.status(401).json({ error: 'Unauthorized' })
  }

  const id = request.user.id

  const bodySchema = z
    .object({
      name: z.string(),
      email: z.string().email(),
      password: z.string().optional(),
      old_password: z.string().optional(),
    })
    .refine(
      data => {
        if (data.password && !data.old_password) {
          return false
        }
        return true
      },
      {
        message: 'Old password is required',
        path: ['old_password'],
      },
    )
  const { name, email, password, old_password } = dataValidation(
    bodySchema,
    request.body,
  )

  const updateUserUseCase: UpdateUserUseCase.UseCase =
    container.resolve('UpdateUserUseCase')

  const user = await updateUserUseCase.execute({
    user_id: id,
    name,
    email,
    password,
    old_password,
  })

  return response.status(200).json(instanceToInstance(user))
}
