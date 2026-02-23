/* eslint-disable prettier/prettier */
import { Router } from 'express'
import { isAuthenticatedJwt } from '../../../../common/infrastructure/http/middlewares/isAuthenticatedJwt.js'
import { createUserController } from '../controllers/create-user.controller.js'
import { authenticateUserController } from '../controllers/authenticate-user.controller.js'
import { getUserController } from '../controllers/get-user.controller.js'
import { updateUserController } from '../controllers/update-user.controller.js'
import { searchUserController } from '../controllers/search-user.controller.js'
import { resetPasswordController } from '../controllers/reset-password.controller.js'
import { sendEmailToResetPasswordController } from '../controllers/send-email-to-reset-password.controller.js'

const userRoutes = Router()

userRoutes.post('/users', createUserController)
userRoutes.post('/users/login', authenticateUserController)

userRoutes.get('/users/profile', isAuthenticatedJwt, getUserController)
userRoutes.put('/users/profile', isAuthenticatedJwt, updateUserController)

userRoutes.get('/users', searchUserController)

userRoutes.post('/users/reset-password', resetPasswordController)
userRoutes.post('/users/forgot-password', sendEmailToResetPasswordController)

export { userRoutes }
