/* eslint-disable prettier/prettier */
import { Router } from 'express'
import { getHostMetricsController } from '../controllers/get-host-metrics.controller.js'

const hostMetricsRoutes = Router()

hostMetricsRoutes.get('/host/status', getHostMetricsController)

export { hostMetricsRoutes }
