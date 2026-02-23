/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { IUsersRepository } from '../../domain/repositories/users-repository.interface.js'
import { HashProvider } from '../../../common/domain/providers/hash-provider.js'
import { ConflictError } from '../../../common/domain/errors/conflict-error.js'

export namespace CreateUserUseCase {
  export type Input = {
    name: string
    email: string
    password: string
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
      const existingUser = await this.usersRepository.findByEmail(input.email)
      if (existingUser) {
        throw new ConflictError('Email already exists', {
          resource: 'User',
          field: 'email',
          value: input.email,
        })
      }

      const hashedPassword = await this.hashProvider.generateHash(input.password)

      const user = await this.usersRepository.create({
        name: input.name,
        email: input.email,
        password: hashedPassword,
      })

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
