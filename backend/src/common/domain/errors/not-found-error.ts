/* eslint-disable prettier/prettier */

import { AppError } from './app-error.js'

/**
 * =======================================================
 * @CLASS     : NotFoundError
 * @MODULE    : Common / Errors
 * @PURPOSE   : Representar ausência de recurso/registro
 *              no contexto de domínio, persistência ou configuração.
 * =======================================================
 *
 * @description
 * Este erro é lançado quando uma entidade esperada não é encontrada.
 *
 * Exemplos no seu projeto:
 *
 * - Usuário não encontrado no MongoDB
 * - Client não registrado (ex: Client03 inexistente)
 * - Setup JSON ausente
 * - Consulta histórica sem dados no período solicitado
 * - Documento inexistente na persistência
 * - Asset/tag não configurado
 *
 *
 * Decisão operacional:
 * - Categoria padrão: 'DATABASE' ou 'VALIDATION' dependendo do caso
 * - retryable: false (buscar novamente não muda o resultado)
 * - isOperational: true
 *
 * @example
 * throw new NotFoundError('User not found', { id: userId })
 */
export class NotFoundError extends AppError {

  /**
   * Detalhes opcionais para diagnóstico.
   */
  public readonly details?: Record<string, unknown>;

  /**
   * Cria um erro de recurso não encontrado.
   *
   * @param message - Mensagem descritiva.
   * @param details - Informações adicionais (ex: id consultado).
   * @param category - Categoria opcional (default: 'DATABASE').
   */
  constructor(
    message: string,
    details?: Record<string, unknown>,
    category: 'DATABASE' | 'VALIDATION' = 'DATABASE'
  ) {
    super(message, {
      category,
      isOperational: true,
      retryable: false,
    });

    this.name = 'NotFoundError';
    this.details = details;
  }
}
