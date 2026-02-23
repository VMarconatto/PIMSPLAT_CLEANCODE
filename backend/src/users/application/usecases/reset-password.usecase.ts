/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { IUsersRepository } from '../../domain/repositories/users-repository.interface.js'
import { IUserTokensRepository } from '../../domain/repositories/user-tokens-repository.interface.js'
import { HashProvider } from '../../../common/domain/providers/hash-provider.js'
import { NotFoundError } from '../../../common/domain/errors/not-found-error.js'
import { AppError } from '../../../common/domain/errors/app-error.js'

export namespace ResetPasswordUseCase {
  export type Input = {
    token: string
    password: string
  }

  export type Output = void

  @injectable()
  export class UseCase {
    constructor(
      @inject('UsersRepository')
      private usersRepository: IUsersRepository,
      @inject('UserTokensRepository')
      private userTokensRepository: IUserTokensRepository,
      @inject('HashProvider')
      private hashProvider: HashProvider,
    ) {}

    async execute(input: Input): Promise<Output> {
      const userToken = await this.userTokensRepository.findByToken(input.token)
      if (!userToken) {
        throw new NotFoundError('Token not found')
      }

      const user = await this.usersRepository.findById(userToken.user_id)
      if (!user) {
        throw new NotFoundError('User not found')
      }

      const tokenCreatedAt = userToken.created_at
      const now = new Date()
      const diffInHours = (now.getTime() - tokenCreatedAt.getTime()) / (1000 * 60 * 60)

      if (diffInHours > 2) {
        throw new AppError('Token expired', {
          category: 'VALIDATION',
          retryable: false,
          isOperational: true,
        })
      }

      user.password = await this.hashProvider.generateHash(input.password)
      await this.usersRepository.save(user)
    }
  }
}
