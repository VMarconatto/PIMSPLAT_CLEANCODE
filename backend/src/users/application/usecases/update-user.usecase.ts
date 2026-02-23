/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { IUsersRepository } from '../../domain/repositories/users-repository.interface.js'
import { HashProvider } from '../../../common/domain/providers/hash-provider.js'
import { NotFoundError } from '../../../common/domain/errors/not-found-error.js'
import { ConflictError } from '../../../common/domain/errors/conflict-error.js'
import { InvalidCredentialsError } from '../../../common/domain/errors/invalid-credentials-error.js'

export namespace UpdateUserUseCase {
  export type Input = {
    user_id: string
    name: string
    email: string
    password?: string
    old_password?: string
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
      @inject('HashProvider')
      private hashProvider: HashProvider,
    ) {}

    async execute(input: Input): Promise<Output> {
      const user = await this.usersRepository.findById(input.user_id)
      if (!user) {
        throw new NotFoundError('User not found', { id: input.user_id })
      }

      if (input.email !== user.email) {
        const existingUser = await this.usersRepository.findByEmail(input.email)
        if (existingUser) {
          throw new ConflictError('Email already in use', {
            resource: 'User',
            field: 'email',
            value: input.email,
          })
        }
      }

      if (input.password) {
        if (!input.old_password) {
          throw new InvalidCredentialsError('Old password is required')
        }

        const oldPasswordMatch = await this.hashProvider.compareHash(
          input.old_password,
          user.password,
        )
        if (!oldPasswordMatch) {
          throw new InvalidCredentialsError('Old password does not match')
        }

        user.password = await this.hashProvider.generateHash(input.password)
      }

      user.name = input.name
      user.email = input.email

      const updated = await this.usersRepository.save(user)

      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        avatar: updated.avatar,
        created_at: updated.created_at,
      }
    }
  }
}
