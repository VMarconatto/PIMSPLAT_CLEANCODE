/* eslint-disable prettier/prettier */

/**
 * @file hash-provider.ts
 * @description
 * Contrato (interface) para um provedor de hashing no nível de domínio.
 *
 * Usado para operações como:
 * - hash de senha antes de persistir
 * - comparação segura de senha com hash armazenado
 *
 * Este contrato permite trocar implementações (bcrypt, argon2, scrypt, etc.)
 * sem alterar regras do domínio nem casos de uso.
 */
export interface HashProvider {
  /**
   * Gera um hash a partir de um payload (ex: senha).
   *
   * @param payload - Texto original que será transformado em hash.
   * @returns Uma Promise com o hash gerado (string).
   */
  generateHash(payload: string): Promise<string>

  /**
   * Compara um payload com um hash previamente gerado.
   *
   * @param payload - Texto original (ex: senha digitada).
   * @param hashed - Hash armazenado (ex: no banco).
   * @returns Uma Promise com `true` se corresponder, senão `false`.
   */
  compareHash(payload: string, hashed: string): Promise<boolean>
}
