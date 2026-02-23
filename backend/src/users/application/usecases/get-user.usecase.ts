/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { IUsersRepository } from '../../domain/repositories/users-repository.interface.js'
import { NotFoundError } from '../../../common/domain/errors/not-found-error.js'

export namespace GetUserUseCase {
  export type Input = {
    id: string
  }

  export type Output = {
    id: string
    name: string
    email: string
    avatar: string | null
    created_at: Date
  }

  @injectable()
  export class UseCase {
    constructor(
      @inject('UsersRepository')
      private usersRepository: IUsersRepository,
    ) {}

    async execute(input: Input): Promise<Output> {
      const user = await this.usersRepository.findById(input.id)
      if (!user) {
        throw new NotFoundError('User not found', { id: input.id })
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        created_at: user.created_at,
      }
    }
  }
}
