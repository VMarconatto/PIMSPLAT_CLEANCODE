/* eslint-disable prettier/prettier */
import { NextFunction, Request, Response } from "express"

// Ajuste os imports conforme seu path real
import { AppError } from "../../../domain/errors/app-error.js"
import { BadRequestError } from "../../../domain/errors/bad-request-error.js"
import { ConflictError } from "../../../domain/errors/conflict-error.js"
import { InvalidCredentialsError } from "../../../domain/errors/invalid-credentials-error.js"
import { NotFoundError } from "../../../domain/errors/not-found-error.js"
import { UnauthorizedError } from "../../../domain/errors/unauthorized-error.js"

/**
 * @file errorHandler.ts
 * @description
 * Middleware global de tratamento de erros (Express).
 *
 * Converte erros da aplicação (AppError e subclasses) para HTTP:
 * - Erros conhecidos -> status coerente + payload estruturado
 * - Erros desconhecidos -> 500 + log (stack)
 *
 * Importante:
 * - Este arquivo fica na borda HTTP (Infrastructure).
 * - O core (Domain/Application) não deve conhecer status HTTP.
 */

function resolveHttpStatus(err: AppError): number {
  // Mapeamento por classe (mais específico)
  if (err instanceof BadRequestError) return 400
  if (err instanceof InvalidCredentialsError) return 401
  if (err instanceof UnauthorizedError) return 403
  if (err instanceof NotFoundError) return 404
  if (err instanceof ConflictError) return 409

  // Fallback por categoria + retryable (pipeline industrial)
  // - se retryable (infra temporária): 503
  // - se não retryable: 500 ou 400 dependendo da categoria
  if (err.category === "VALIDATION") return 400

  if (err.category === "OPCUA") return err.retryable ? 503 : 500
  if (err.category === "RABBITMQ") return err.retryable ? 503 : 500
  if (err.category === "DATABASE") return err.retryable ? 503 : 500
  if (err.category === "INFRASTRUCTURE") return err.retryable ? 503 : 500

  return 500
}

function pickDetails(err: any): Record<string, unknown> | undefined {
  // suas subclasses têm "details?: Record<string, unknown>"
  if (err && typeof err === "object" && "details" in err) {
    const details = (err as any).details
    if (details && typeof details === "object") return details
  }
  return undefined
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
): Response {
  // Erros "conhecidos" do domínio/pipeline
  if (err instanceof AppError) {
    const status = resolveHttpStatus(err)
    const details = pickDetails(err)

    return res.status(status).json({
      error: {
        name: err.name,
        message: err.message,
        category: err.category,
        retryable: err.retryable,
        isOperational: err.isOperational,
        timestamp: err.timestamp?.toISOString?.() ?? new Date().toISOString(),
        ...(details ? { details } : {}),
      },
    })
  }

  // Erros desconhecidos (bug ou falha não tratada)
  console.error("❌ Unhandled error:", err)

  return res.status(500).json({
    error: {
      name: "InternalServerError",
      message: "Internal Server Error",
      timestamp: new Date().toISOString(),
    },
  })
}
