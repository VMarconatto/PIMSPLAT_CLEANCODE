/* eslint-disable prettier/prettier */
import {
  IAuthProvider,
  GenerateAuthKeyProps,
  VerifyAuthKeyProps,
} from '../../../domain/providers/auth-provider.js'
import jwt from 'jsonwebtoken'
import { env } from '../../env/index.js'
import { InvalidCredentialsError } from '../../../domain/errors/invalid-credentials-error.js'

/**
 * @file auth-provider.jwt.ts
 * @description
 * Implementação concreta do provedor de autenticação baseada em JWT (JSON Web Token).
 *
 * Este arquivo pertence à camada de Infrastructure e atua como um *adapter*,
 * implementando a interface `IAuthProvider` definida no domínio.
 *
 * Responsabilidades:
 * - gerar tokens JWT para autenticação
 * - validar tokens JWT e extrair o identificador do usuário
 *
 * Observação arquitetural:
 * - O domínio conhece apenas a interface `IAuthProvider`
 * - A infraestrutura fornece esta implementação concreta (JWT)
 * - A injeção acontece via container (tsyringe)
 */

/**
 * @typedef DecodedTokenProps
 * @description
 * Estrutura mínima esperada ao decodificar um token JWT.
 *
 * O campo `sub` (subject) é utilizado para armazenar o ID do usuário.
 */
type DecodedTokenProps = {
  sub: string
}

/**
 * @class JwtAuthProvider
 * @description
 * Provedor de autenticação baseado em JWT.
 *
 * Implementa:
 * - geração de token (`generateAuthKey`)
 * - verificação de token (`verifyAuthKey`)
 *
 * Esta classe encapsula completamente a biblioteca `jsonwebtoken`,
 * evitando que detalhes de JWT vazem para camadas superiores.
 */
export class JwtAuthProvider implements IAuthProvider {
  /**
   * Gera um token de autenticação JWT para um usuário.
   *
   * Estratégia:
   * - token assinado com `JWT_SECRET`
   * - tempo de expiração definido em `JWT_EXPIRES_IN`
   * - ID do usuário armazenado no campo `sub` (subject)
   *
   * @param user_id - Identificador único do usuário.
   * @returns Objeto contendo o token de acesso gerado.
   *
   * @example
   * const { access_token } = authProvider.generateAuthKey(userId)
   */
  generateAuthKey(user_id: string): GenerateAuthKeyProps {
    const access_token = jwt.sign({}, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
      subject: user_id,
    })

    return { access_token }
  }

  /**
   * Verifica a validade de um token JWT e extrai o ID do usuário.
   *
   * Fluxo:
   * - valida assinatura e expiração do token
   * - extrai o campo `sub` (subject)
   * - retorna o `user_id` se válido
   *
   * Em caso de token inválido, expirado ou malformado,
   * lança um `InvalidCredentialsError`.
   *
   * @param token - Token JWT recebido no header Authorization.
   * @returns Objeto contendo o ID do usuário extraído do token.
   * @throws InvalidCredentialsError quando o token é inválido.
   *
   * @example
   * const { user_id } = authProvider.verifyAuthKey(token)
   */
  verifyAuthKey(token: string): VerifyAuthKeyProps {
    try {
      const decodedToken = jwt.verify(token, env.JWT_SECRET)
      const { sub } = decodedToken as DecodedTokenProps

      return { user_id: sub }
    } catch {
      throw new InvalidCredentialsError('Invalid credentials')
    }
  }
}
