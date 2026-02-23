/* eslint-disable prettier/prettier */

import { AppError, ErrorCategory } from './app-error.js'

/**
 * =======================================================
 * @CLASS     : ConflictError
 * @MODULE    : Common / Errors
 * @PURPOSE   : Representar conflito de estado/regra de negócio,
 *              típico em violações de unicidade e colisões de recursos.
 * =======================================================
 *
 * @description
 * Este erro é o equivalente conceitual do "HTTP 409 Conflict",
 * porém é usado de forma agnóstica de transporte (HTTP, consumer, CLI).
 *
 * Quando usar (exemplos comuns no seu projeto):
 * - Cadastro de usuário: e-mail/username já cadastrado (unique index)
 * - Tentativa de criar recurso com chave já existente
 * - Conflito de versão/concorrência otimista (quando aplicável)
 *
 * Decisão operacional:
 * - `retryable = false` pois repetir não resolve conflito de unicidade.
 * - Categoria padrão: `VALIDATION` (regra/estado atual do sistema).
 *   Em cenários específicos, pode ser `DATABASE` (ex: versão/locking).
 *
 * @example
 * throw new ConflictError('Email already exists', {
 *   resource: 'User',
 *   field: 'email',
 *   value: 'someone@domain.com'
 * })
 */
export class ConflictError extends AppError {
  /**
   * Detalhes opcionais para diagnóstico (campo, valor, recurso, etc.).
   */
  public readonly details?: Record<string, unknown>

  /**
   * Cria um erro de conflito.
   *
   * @param message - Mensagem descritiva do conflito.
   * @param details - Informações adicionais úteis para logs e respostas futuras.
   * @param category - Categoria opcional. Default: 'VALIDATION'.
   */
  constructor(
    message: string,
    details?: Record<string, unknown>,
    category: ErrorCategory = 'VALIDATION'
  ) {
    super(message, {
      category,
      isOperational: true,
      retryable: false,
      // cause: opcional (normalmente você passa o erro original quando capturar)
    })

    this.name = 'ConflictError'
    this.details = details
  }
}
