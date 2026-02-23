/* eslint-disable prettier/prettier */
import { inject, injectable } from 'tsyringe'
import { DataSource, ILike, Repository } from 'typeorm'
import { UserEntity } from '../entities/user.entity.js'
import {
  CreateUserDTO,
  IUsersRepository,
  SearchUsersParams,
  SearchUsersResult,
} from '../../../domain/repositories/users-repository.interface.js'

@injectable()
export class UsersTypeormRepository implements IUsersRepository {
  private repo: Repository<UserEntity>

  constructor(@inject('DataSource') dataSource: DataSource) {
    this.repo = dataSource.getRepository(UserEntity)
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ id })
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ email })
  }

  async create(data: CreateUserDTO): Promise<UserEntity> {
    const user = this.repo.create(data)
    return this.repo.save(user)
  }

  async save(user: UserEntity): Promise<UserEntity> {
    return this.repo.save(user)
  }

  async search(params: SearchUsersParams): Promise<SearchUsersResult> {
    const { page, per_page, sort, sort_dir, filter } = params

    const skip = (page - 1) * per_page

    const where = filter
      ? [
          { name: ILike(`%${filter}%`) },
          { email: ILike(`%${filter}%`) },
        ]
      : undefined

    const order: Record<string, 'ASC' | 'DESC'> = {}
    if (sort) {
      order[sort] = (sort_dir?.toUpperCase() === 'DESC') ? 'DESC' : 'ASC'
    } else {
      order['created_at'] = 'DESC'
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order,
      skip,
      take: per_page,
    })

    return {
      items,
      total,
      current_page: page,
      per_page,
      last_page: Math.ceil(total / per_page),
    }
  }
}
