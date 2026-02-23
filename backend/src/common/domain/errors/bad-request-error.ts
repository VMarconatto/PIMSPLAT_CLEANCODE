/* eslint-disable prettier/prettier */

import { AppError } from "./app-error.js";

/**
 * =======================================================
 * @CLASS     : BadRequestError
 * @MODULE    : Common / Errors
 * @PURPOSE   : Representar erro de entrada inválida (validação),
 *              aplicável a requisições de consulta (período),
 *              filtros, paginação e payloads do pipeline.
 * =======================================================
 *
 * @description
 * Este erro é o equivalente ao "HTTP 400", porém no contexto do coletor
 * ele é usado de forma agnóstica (pode existir API HTTP futuramente,
 * mas também pode existir uso interno via consumer/CLI).
 *
 * Quando lançar:
 * - Parâmetros de período inválidos (from/to)
 * - Intervalo invertido (from > to)
 * - Janela muito grande (ex: range não permitido)
 * - Filtros ausentes/invalidos (clientId, collection)
 * - Payload malformado recebido do RabbitMQ (quando o problema é de validação)
 *
 * Decisão operacional:
 * - `retryable = false` porque validar novamente não vai corrigir o input.
 * - Categoria: `VALIDATION` para permitir tratamento coerente e logs.
 */
export class BadRequestError extends AppError {
  /**
   * Detalhes opcionais para diagnóstico (ex: campos inválidos).
   * Útil para logs e respostas HTTP futuras.
   */
  public readonly details?: Record<string, unknown>;

  /**
   * Cria um erro de entrada inválida.
   *
   * @param message - Mensagem descritiva do que está inválido.
   * @param details - Objeto opcional com informações adicionais (campos, valores, etc.).
   *
   * @example
   * throw new BadRequestError('Invalid date range: "from" must be <= "to"', {
   *   from: '2026-02-01',
   *   to: '2026-01-01'
   * })
   */
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      category: 'VALIDATION',
      isOperational: true,
      retryable: false,
    });

    this.name = 'BadRequestError';
    this.details = details;
  }
}
