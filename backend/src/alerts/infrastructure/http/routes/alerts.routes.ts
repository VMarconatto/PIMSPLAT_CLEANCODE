/* eslint-disable prettier/prettier */

/**
 * @file alerts.routes.ts
 * @description
 * Define as rotas HTTP do módulo **Alerts**, registrando os endpoints
 * de consulta de alertas enviados e de resumo agregado por cliente.
 *
 * @remarks
 * **Endpoints registrados:**
 *
 * | Método | Path                            | Controller                      | Descrição                                  |
 * |--------|---------------------------------|---------------------------------|--------------------------------------------|
 * | GET    | `/:clientId/alerts-sent`        | `getAlertsSentController`       | Lista alertas enviados com filtros opcionais |
 * | GET    | `/:clientId/alerts-summary`     | `getAlertsSummaryController`    | Retorna resumo agregado de alertas          |
 *
 * **Parâmetro de rota comum:**
 * - `:clientId` — Identificador único do cliente OPC UA. Obrigatório em todos os endpoints.
 *
 * **Integração:** Este router deve ser montado no servidor Express principal
 * com um prefixo de rota base (ex.: `/api/alerts` ou `/alerts`).
 *
 * @example
 * ```typescript
 * // No servidor Express:
 * import { alertsRoutes } from './alerts/infrastructure/http/routes/alerts.routes.js'
 * app.use('/api', alertsRoutes)
 *
 * // Endpoints resultantes:
 * // GET /api/:clientId/alerts-sent?tagName=...&startYear=...
 * // GET /api/:clientId/alerts-summary
 * ```
 *
 * @module alerts/infrastructure/http/routes/alerts
 */

import { Router } from 'express'
import { getAlertsSentController } from '../controllers/get-alerts-sent.controller.js'
import { getAlertsSummaryController } from '../controllers/get-alerts-summary.controller.js'

/**
 * Router Express do módulo Alerts.
 *
 * @remarks
 * Instância dedicada de `Router` para isolamento das rotas do módulo,
 * evitando colisões com rotas de outros módulos da aplicação.
 */
const alertsRoutes = Router()

/**
 * GET `/:clientId/alerts-sent`
 *
 * Retorna a lista de alertas enviados para um cliente, com suporte a filtros
 * opcionais de tag, site e intervalo temporal via query params.
 *
 * @see {@link getAlertsSentController} para detalhes dos query params aceitos.
 */
alertsRoutes.get('/:clientId/alerts-sent', getAlertsSentController)

/**
 * GET `/:clientId/alerts-summary`
 *
 * Retorna o resumo agregado dos alertas de um cliente: total, contagem por
 * nível de desvio, contagem por tag e timestamp do último alerta.
 *
 * @see {@link getAlertsSummaryController} para detalhes da resposta.
 */
alertsRoutes.get('/:clientId/alerts-summary', getAlertsSummaryController)

export { alertsRoutes }
