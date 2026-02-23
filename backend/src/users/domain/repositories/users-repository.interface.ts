/* eslint-disable prettier/prettier */
import { UserEntity } from '../../infrastructure/typeorm/entities/user.entity.js'

export type CreateUserDTO = {
  name: string
  email: string
  password: string
}

export type SearchUsersParams = {
  page: number
  per_page: number
  sort: string | null
  sort_dir: string | null
  filter: string | null
}

export type SearchUsersResult = {
  items: UserEntity[]
  total: number
  current_page: number
  per_page: number
  last_page: number
}

export interface IUsersRepository {
  findById(id: string): Promise<UserEntity | null>
  findByEmail(email: string): Promise<UserEntity | null>
  create(data: CreateUserDTO): Promise<UserEntity>
  save(user: UserEntity): Promise<UserEntity>
  search(params: SearchUsersParams): Promise<SearchUsersResult>
}
