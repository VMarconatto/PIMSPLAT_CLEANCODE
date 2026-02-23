/* eslint-disable prettier/prettier */
import { NextFunction, Request, Response } from 'express'
import { container } from 'tsyringe'
import { IAuthProvider } from '../../../domain/providers/auth-provider.js'
import { InvalidCredentialsError } from '../../../domain/errors/invalid-credentials-error.js'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
      }
    }
  }
}

export function isAuthenticatedJwt(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    throw new InvalidCredentialsError('Token is missing')
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new InvalidCredentialsError('Invalid token format')
  }

  const token = parts[1]

  const authProvider: IAuthProvider = container.resolve('IAuthProvider')
  const { user_id } = authProvider.verifyAuthKey(token)

  req.user = { id: user_id }

  return next()
}
