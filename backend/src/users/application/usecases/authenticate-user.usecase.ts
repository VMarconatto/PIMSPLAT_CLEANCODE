/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { IUsersRepository } from '../../domain/repositories/users-repository.interface.js'
import { HashProvider } from '../../../common/domain/providers/hash-provider.js'
import { InvalidCredentialsError } from '../../../common/domain/errors/invalid-credentials-error.js'

export namespace AuthenticateUserUseCase {
  export type Input = {
    email: string
    password: string
  }

  export type Output = {
    id: string
    name: string
    email: string
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
      const user = await this.usersRepository.findByEmail(input.email)
      if (!user) {
        throw new InvalidCredentialsError('Invalid email or password')
      }

      const passwordMatch = await this.hashProvider.compareHash(
        input.password,
        user.password,
      )
      if (!passwordMatch) {
        throw new InvalidCredentialsError('Invalid email or password')
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
      }
    }
  }
}
