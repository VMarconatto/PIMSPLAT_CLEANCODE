/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { IUsersRepository } from '../../domain/repositories/users-repository.interface.js'
import { IUserTokensRepository } from '../../domain/repositories/user-tokens-repository.interface.js'
import { NotFoundError } from '../../../common/domain/errors/not-found-error.js'

export namespace SendEmailToResetPasswordUseCase {
  export type Input = {
    email: string
  }

  export type Output = {
    user: { name: string; email: string }
    token: string
  }

  @injectable()
  export class UseCase {
    constructor(
      @inject('UsersRepository')
      private usersRepository: IUsersRepository,
      @inject('UserTokensRepository')
      private userTokensRepository: IUserTokensRepository,
    ) {}

    async execute(input: Input): Promise<Output> {
      const user = await this.usersRepository.findByEmail(input.email)
      if (!user) {
        throw new NotFoundError('User not found', { email: input.email })
      }

      const userToken = await this.userTokensRepository.generate(user.id)

      return {
        user: { name: user.name, email: user.email },
        token: userToken.token,
      }
    }
  }
}
