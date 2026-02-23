/* eslint-disable prettier/prettier */

/**
 * @file index.ts
 * @description
 * Container (DI) do módulo **Users**.
 *
 * Registra repositórios e casos de uso do módulo de usuários
 * no container de injeção de dependência (tsyringe).
 */

import { container } from 'tsyringe'
import { dataSource } from '../../../common/infrastructure/typeorm/index.js'
import { UsersTypeormRepository } from '../typeorm/repositories/users-typeorm.repository.js'
import { UserTokensTypeormRepository } from '../typeorm/repositories/user-tokens-typeorm.repository.js'
import { CreateUserUseCase } from '../../application/usecases/create-user.usecase.js'
import { AuthenticateUserUseCase } from '../../application/usecases/authenticate-user.usecase.js'
import { GetUserUseCase } from '../../application/usecases/get-user.usecase.js'
import { UpdateUserUseCase } from '../../application/usecases/update-user.usecase.js'
import { SearchUserUseCase } from '../../application/usecases/search-user.usecase.js'
import { ResetPasswordUseCase } from '../../application/usecases/reset-password.usecase.js'
import { SendEmailToResetPasswordUseCase } from '../../application/usecases/send-email-to-reset-password.usecase.js'

/**
 * DataSource (TypeORM)
 */
container.registerInstance('DataSource', dataSource)

/**
 * Repositórios
 */
container.registerSingleton('UsersRepository', UsersTypeormRepository)
container.registerSingleton('UserTokensRepository', UserTokensTypeormRepository)

/**
 * Casos de Uso
 */
container.registerSingleton('CreateUserUseCase', CreateUserUseCase.UseCase)
container.registerSingleton('AuthenticateUserUseCase', AuthenticateUserUseCase.UseCase)
container.registerSingleton('GetUserUseCase', GetUserUseCase.UseCase)
container.registerSingleton('UpdateUserUseCase', UpdateUserUseCase.UseCase)
container.registerSingleton('SearchUserUseCase', SearchUserUseCase.UseCase)
container.registerSingleton('ResetPasswordUseCase', ResetPasswordUseCase.UseCase)
container.registerSingleton('SendEmailToResetPasswordUseCase', SendEmailToResetPasswordUseCase.UseCase)
