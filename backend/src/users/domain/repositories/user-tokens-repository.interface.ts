/* eslint-disable prettier/prettier */
import { UserTokenEntity } from '../../infrastructure/typeorm/entities/user-token.entity.js'

export interface IUserTokensRepository {
  generate(user_id: string): Promise<UserTokenEntity>
  findByToken(token: string): Promise<UserTokenEntity | null>
}
