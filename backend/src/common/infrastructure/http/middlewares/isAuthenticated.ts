/* eslint-disable prettier/prettier */
import { NextFunction, Request, Response } from "express"
import { AppError } from "../../../domain/errors/app-error.js"
import { InvalidCredentialsError } from "../../../domain/errors/invalid-credentials-error.js"
import { env } from "../../env/index.js"

/**
 * @file isAuthenticated.ts
 * @description
 * Guard simples por API Key (ambiente industrial / rede interna).
 *
 * Estratégia:
 * - Header esperado: `x-api-key: <key>`
 * - Se ausente ou inválido -> InvalidCredentialsError (401)
 * - Se API_KEY não configurada no servidor em produção -> AppError INFRASTRUCTURE (500)
 *
 * Obs:
 * - Se no futuro você quiser JWT, dá pra criar outro middleware `isAuthenticatedJwt`.
 */

export function isAuthenticated(req: Request, _res: Response, next: NextFunction): void {
  const apiKey = (req.headers["x-api-key"] as string | undefined)?.trim()

  const expected = env.API_KEY

  // API_KEY não configurada no servidor
  if (!expected) {
    if (env.NODE_ENV === "production") {
      throw new AppError("API_KEY is not configured on server", {
        category: "INFRASTRUCTURE",
        isOperational: false,
        retryable: false,
      })
    }
    // Em dev/test, libera sem autenticação
    return next()
  }

  if (!apiKey) {
    throw new InvalidCredentialsError("API key is missing")
  }

  if (apiKey !== expected) {
    throw new InvalidCredentialsError("Invalid API key")
  }

  return next()
}
