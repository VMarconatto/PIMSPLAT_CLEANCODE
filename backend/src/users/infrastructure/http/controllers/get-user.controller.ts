/* eslint-disable prettier/prettier */
import { GetUserUseCase } from '../../../application/usecases/get-user.usecase.js'
import { instanceToInstance } from 'class-transformer'
import { Request, Response } from 'express'
import { container } from 'tsyringe'

/**
 * @fileoverview Get User Controller (HTTP)
 *
 * Controller responsável por retornar os dados do usuário autenticado (ou alvo),
 * delegando a busca ao `GetUserUseCase`.
 *
 * ## Observação sobre `request.user`
 * O controller assume que existe um middleware de autenticação anterior
 * que popula `request.user`. Se não houver, retorna 401.
 *
 * ## Sobre `class-transformer`
 * `instanceToInstance` é usado para transformar/serializar a entidade,
 * geralmente para aplicar decorators como `@Exclude()` e `@Expose()`.
 * Isso ajuda a não vazar campos sensíveis (dependendo de como a Entity foi modelada).
 */

/**
 * Obtém o usuário atual baseado em `request.user.id`.
 *
 * ## Saída
 * - **200 OK** com o usuário (transformado por `instanceToInstance`)
 * - **401 Unauthorized** quando `request.user` não existe
 *
 * @param request - Request Express (espera `request.user` preenchido por middleware).
 * @param response - Response Express.
 * @returns Response com status 200 e o usuário; ou 401 se não autenticado.
 */
export async function getUserController(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!request.user) {
    return response.status(401).json({ error: 'Unauthorized' })
  }

  const id = request.user.id

  const getUserUseCase: GetUserUseCase.UseCase =
    container.resolve('GetUserUseCase')

  const user = await getUserUseCase.execute({ id })

  return response.status(200).json(instanceToInstance(user))
}
