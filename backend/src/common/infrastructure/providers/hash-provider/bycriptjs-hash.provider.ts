/* eslint-disable prettier/prettier */
import { compare, hash } from 'bcryptjs'
import { HashProvider } from '../../../domain/providers/hash-provider.js'

/**
 * @file bycriptjs-hash.provider.ts
 * @description
 * Implementação concreta do provedor de hash baseada na biblioteca `bcryptjs`.
 *
 * Este arquivo pertence à camada de Infrastructure e implementa o contrato
 * `HashProvider` definido no domínio.
 *
 * Responsabilidades:
 * - gerar hash seguro de dados sensíveis (ex: senha)
 * - comparar payload em texto puro com um hash armazenado
 *
 * Observação arquitetural:
 * - O domínio conhece apenas a interface `HashProvider`
 * - A infraestrutura fornece esta implementação concreta
 * - A injeção acontece via container (tsyringe)
 */

/**
 * @class BcryptjsHashProvider
 * @description
 * Provedor de hash usando `bcryptjs`.
 *
 * Detalhes de implementação:
 * - Usa `bcryptjs.hash` com salt rounds fixos (6)
 * - Usa `bcryptjs.compare` para validação segura
 *
 * Observação:
 * - O valor de salt rounds pode ser futuramente externalizado
 *   para configuração de ambiente, se necessário.
 */
export class BcryptjsHashProvider implements HashProvider {
  /**
   * Gera um hash criptográfico a partir de um payload.
   *
   * Usado principalmente para:
   * - armazenamento seguro de senhas
   *
   * @param payload - Texto original a ser transformado em hash.
   * @returns Hash gerado (string).
   *
   * @example
   * const hashed = await hashProvider.generateHash('myPassword')
   */
  async generateHash(payload: string): Promise<string> {
    return hash(payload, 6)
  }

  /**
   * Compara um payload em texto puro com um hash armazenado.
   *
   * @param payload - Texto original (ex: senha informada pelo usuário).
   * @param hashed - Hash previamente armazenado.
   * @returns `true` se corresponder, senão `false`.
   *
   * @example
   * const isValid = await hashProvider.compareHash('password', user.password)
   */
  async compareHash(payload: string, hashed: string): Promise<boolean> {
    return compare(payload, hashed)
  }
}
