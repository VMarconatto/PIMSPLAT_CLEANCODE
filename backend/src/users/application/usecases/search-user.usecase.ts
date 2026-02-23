/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { IUsersRepository, SearchUsersResult } from '../../domain/repositories/users-repository.interface.js'

export namespace SearchUserUseCase {
  export type Input = {
    page: number
    per_page: number
    sort: string | null
    sort_dir: string | null
    filter: string | null
  }

  export type Output = SearchUsersResult

  @injectable()
  export class UseCase {
    constructor(
      @inject('UsersRepository')
      private usersRepository: IUsersRepository,
    ) {}

    async execute(input: Input): Promise<Output> {
      return this.usersRepository.search(input)
    }
  }
}
