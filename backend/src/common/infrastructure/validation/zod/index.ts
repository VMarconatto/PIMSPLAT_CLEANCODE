/* eslint-disable prettier/prettier */
import { z } from 'zod'
import { AppError } from "../../../domain/errors/app-error.js"

/**
 * @file dataValidation.ts
 * @description
 * Helper de validação com Zod para padronizar validações (HTTP/Rabbit/OPC UA envelope).
 *
 * - Retorna dados tipados quando válido
 * - Lança AppError quando inválido (não retryable)
 */

export function dataValidation<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  data: unknown,
  opts?: { message?: string },
): z.infer<TSchema> {
  const parsed = schema.safeParse(data)

  if (!parsed.success) {
    const issuesText = parsed.error.issues
      .map((err) => `${err.path.join('.')} -> ${err.message}`)
      .join(' | ')

    throw new AppError(
      opts?.message ?? `Dados inválidos: ${issuesText}`,
      {
        category: 'VALIDATION',
        retryable: false,
        isOperational: true,
        // se o seu AppErrorOptions tiver "cause", pode manter:
        cause: parsed.error,
      } as any, // <- remove isso se seu AppErrorOptions já aceitar cause
    )
  }

  return parsed.data
}
