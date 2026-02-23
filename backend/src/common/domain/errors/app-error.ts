/* eslint-disable prettier/prettier */

/**
 * =======================================================
 * @CLASS     : AppError
 * @MODULE    : Common / Errors
 * @PURPOSE   : Classe base para todos os erros da aplicação
 *              no contexto de coleta OPC UA, mensageria e persistência.
 * =======================================================
 *
 * @description
 * Diferente da versão utilizada na API REST (focada em HTTP),
 * esta implementação é orientada a pipeline industrial.
 *
 * Ela permite:
 *
 * ✅ Classificação por categoria (OPC UA, RabbitMQ, DB, Validation...)
 * ✅ Indicação se o erro é operacional (esperado) ou de programação
 * ✅ Definir se é retryable (importante para consumidor Rabbit)
 * ✅ Encapsular erro original (cause)
 * ✅ Facilitar logging estruturado
 *
 * ------------------------------------------------------------------
 *  Conceito Arquitetural
 * ------------------------------------------------------------------
 *
 * Em sistemas industriais baseados em mensageria:
 *
 * - Nem todo erro é fatal
 * - Nem todo erro deve gerar retry
 * - Nem todo erro é bug
 *
 * Esta classe é o contrato base para permitir decisões conscientes
 * no consumer (ack / retry / DLQ).
 */

export type ErrorCategory =
  | 'VALIDATION'
  | 'OPCUA'
  | 'RABBITMQ'
  | 'DATABASE'
  | 'INFRASTRUCTURE'
  | 'UNKNOWN';

export interface AppErrorOptions {
  category?: ErrorCategory;
  isOperational?: boolean;
  retryable?: boolean;
  cause?: unknown;
}

export class AppError extends Error {

  /**
   * Categoria funcional do erro.
   * Permite agrupamento por domínio técnico.
   */
  public readonly category: ErrorCategory;

  /**
   * Indica se o erro é esperado dentro do fluxo normal da aplicação.
   * Exemplo:
   * - Falha de conexão temporária OPC UA → true
   * - Null pointer inesperado → false
   */
  public readonly isOperational: boolean;

  /**
   * Indica se o erro pode ser submetido a retry automático.
   * Muito importante para lógica de consumer RabbitMQ.
   */
  public readonly retryable: boolean;

  /**
   * Erro original encapsulado (stack raiz).
   */
  public readonly cause?: unknown;

  /**
   * Timestamp de criação do erro.
   * Útil para auditoria e logging estruturado.
   */
  public readonly timestamp: Date;

  constructor(
    message: string,
    options: AppErrorOptions = {}
  ) {
    super(message);

    this.name = this.constructor.name;

    this.category = options.category ?? 'UNKNOWN';
    this.isOperational = options.isOperational ?? true;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
    this.timestamp = new Date();

    Error.captureStackTrace?.(this, this.constructor);
  }
}
