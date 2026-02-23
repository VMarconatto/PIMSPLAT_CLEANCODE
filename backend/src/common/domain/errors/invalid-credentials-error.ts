/* eslint-disable prettier/prettier */

import { AppError } from './app-error.js'

/**
 * =======================================================
 * @CLASS     : InvalidCredentialsError
 * @MODULE    : Common / Errors
 * @PURPOSE   : Representar erro de autenticação por credenciais inválidas.
 * =======================================================
 *
 * @description
 * Este erro é utilizado quando ocorre falha de autenticação,
 * seja em:
 *
 * - Login de usuário (email/senha)
 * - Validação de token JWT
 * - API key inválida
 * - Credenciais de integração
 * 
 * Decisão operacional:
 * - Categoria: 'VALIDATION'
 * - retryable: false (não adianta tentar novamente automaticamente)
 * - isOperational: true
 *
 * @example
 * throw new InvalidCredentialsError('Invalid email or password')
 */
export class InvalidCredentialsError extends AppError {

  /**
   * Cria um erro de credenciais inválidas.
   *
   * @param message - Mensagem descritiva do erro.
   */
  constructor(message = 'Invalid credentials') {
    super(message, {
      category: 'VALIDATION',
      isOperational: true,
      retryable: false,
    })

    this.name = 'InvalidCredentialsError'
  }
}
