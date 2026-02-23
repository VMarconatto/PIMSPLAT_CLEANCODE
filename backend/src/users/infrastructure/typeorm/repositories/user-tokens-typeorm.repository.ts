/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { DataSource, Repository } from 'typeorm'
import { UserTokenEntity } from '../entities/user-token.entity.js'
import { IUserTokensRepository } from '../../../domain/repositories/user-tokens-repository.interface.js'

@injectable()
export class UserTokensTypeormRepository implements IUserTokensRepository {
  private repo: Repository<UserTokenEntity>

  constructor(@inject('DataSource') dataSource: DataSource) {
    this.repo = dataSource.getRepository(UserTokenEntity)
  }

  async generate(user_id: string): Promise<UserTokenEntity> {
    const userToken = this.repo.create({ user_id })
    return this.repo.save(userToken)
  }

  async findByToken(token: string): Promise<UserTokenEntity | null> {
    return this.repo.findOneBy({ token })
  }
}
