/* eslint-disable prettier/prettier */

/**
 * @file auth-provider.ts
 * @description
 * Contratos (tipos e interface) para um provedor de autenticação no nível de domínio.
 *
 * Este arquivo define as "ports" (interfaces) que a camada de Application/Infrastructure
 * deve implementar, sem acoplar o domínio a detalhes como JWT, OAuth, sessão, etc.
 *
 * Em Clean Architecture, este é um exemplo de *Dependency Inversion*:
 * o domínio define o contrato e a infraestrutura fornece a implementação concreta.
 */

/**
 * @typedef GenerateAuthKeyProps
 * @description
 * Estrutura retornada ao gerar uma chave/token de autenticação.
 *
 * @property access_token - Token de acesso gerado pelo provedor (ex: JWT).
 */
export type GenerateAuthKeyProps = {
  access_token: string
}

/**
 * @typedef VerifyAuthKeyProps
 * @description
 * Estrutura retornada ao validar/decodificar um token.
 *
 * @property user_id - Identificador do usuário extraído do token.
 */
export type VerifyAuthKeyProps = {
  user_id: string
}

/**
 * @interface IAuthProvider
 * @description
 * Contrato de um provedor de autenticação.
 *
 * Responsabilidades típicas:
 * - gerar tokens (ex: login/sessão)
 * - validar tokens (ex: middleware de autenticação)
 *
 * Observação: esta interface é intencionalmente agnóstica de implementação
 * (JWT, OAuth, sessão, etc.).
 */
export interface IAuthProvider {
  /**
   * Gera uma chave/token de autenticação para um usuário.
   *
   * @param user_id - ID do usuário que será associado ao token.
   * @returns Estrutura contendo o token gerado.
   */
  generateAuthKey(user_id: string): GenerateAuthKeyProps

  /**
   * Verifica/valida um token e retorna dados derivados (ex: user_id).
   *
   * @param token - Token a ser verificado (ex: access token).
   * @returns Estrutura contendo o ID do usuário extraído/validado.
   */
  verifyAuthKey(token: string): VerifyAuthKeyProps
}
