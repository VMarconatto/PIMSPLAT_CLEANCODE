/* eslint-disable prettier/prettier */
import { Router } from "express"
import { isAuthenticated } from "./middlewares/isAuthenticated.js"
import { hostMetricsRoutes } from "./routes/host-metrics.routes.js"
import { userRoutes } from "../../../users/infrastructure/http/routes/user.routes.js"
import { telemetryRoutes } from "../../../telemetry/infrastructure/http/routes/telemetry.routes.js"
import { collectorRoutes } from "../../../telemetry/infrastructure/http/routes/collector.routes.js"
import { alertsRoutes } from "../../../alerts/infrastructure/http/routes/alerts.routes.js"
import { opcuaClientProfileRoutes } from "../../../telemetry/infrastructure/http/routes/opcua-client-profile.routes.js"

/**
 * @file routes.ts
 * @description
 * Roteador principal (root router) da aplicacao.
 *
 * Responsabilidades:
 * - Centralizar o mount dos routers de cada modulo
 * - Definir rotas de health/readiness na raiz
 *
 * Observacao:
 * - Cada modulo mantem suas rotas dentro de seu proprio contexto
 *   (ex: `telemetry/infrastructure/http/routes/...`), e este arquivo apenas agrega.
 */

const routes = Router()

// ============================================================
// Health / Readiness
// ============================================================

routes.get("/health", (_req, res) => {
  return res.status(200).json({ status: "ok" })
})

routes.get("/ready", async (_req, res) => {
  return res.status(200).json({
    ready: true,
    dependencies: {
      rabbit: "unknown",
      opcua: "unknown",
      db: "unknown",
    },
  })
})

// ============================================================
// Admin
// ============================================================

routes.post("/admin/reconnect", isAuthenticated, async (_req, res) => {
  return res.status(200).json({ message: "reconnect requested" })
})

// ============================================================
// Host Metrics
// ============================================================

routes.use(hostMetricsRoutes)

// ============================================================
// Modulos (cada modulo define suas proprias rotas)
// ============================================================

routes.use(userRoutes)
routes.use(telemetryRoutes)
routes.use(collectorRoutes)
routes.use(alertsRoutes)
routes.use(opcuaClientProfileRoutes)

export { routes }
