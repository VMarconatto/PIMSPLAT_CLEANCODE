/* eslint-disable prettier/prettier */

import { AppError } from "./app-error.js";

/**
 * =======================================================
 * @CLASS     : UnauthorizedError
 * @MODULE    : Common / Errors
 * @PURPOSE   : Representar erro de autorização insuficiente
 *              para executar determinada operação.
 * =======================================================
 *
 * @description
 * Este erro indica que o usuário/agente está autenticado,
 * porém não possui permissão para acessar o recurso ou executar a ação.
 *
 * Exemplos no seu projeto:
 *
 * - Usuário tentando acessar dados de outro client_id
 * - Token válido, mas sem role necessária
 * - Tentativa de acessar endpoint administrativo sem permissão
 * - API key sem escopo adequado
 *
 *
 * Decisão operacional:
 * - Categoria: 'VALIDATION'
 * - retryable: false (não adianta repetir a mesma operação)
 * - isOperational: true
 *
 * @example
 * throw new UnauthorizedError('User does not have permission to access this client', {
 *   userId,
 *   clientId
 * })
 */
export class UnauthorizedError extends AppError {

  /**
   * Informações adicionais úteis para auditoria e logs.
   */
  public readonly details?: Record<string, unknown>;

  /**
   * Cria um erro de autorização insuficiente.
   *
   * @param message - Mensagem descritiva.
   * @param details - Dados auxiliares (ex: userId, role, clientId).
   */
  constructor(
    message = 'Unauthorized access',
    details?: Record<string, unknown>
  ) {
    super(message, {
      category: 'VALIDATION',
      isOperational: true,
      retryable: false,
    });

    this.name = 'UnauthorizedError';
    this.details = details;
  }
}
