import { setupRabbitTopology } from './messaging/rabbitmq.setup.js'
import { startTelemetryConsumer, startAlertConsumer } from './messaging/consumer.js'
import { env } from './config/env.js'
import pino from 'pino'
import { initializeOpcuaClientsFromJSON } from './telemetry/app/launchers/OpcuaInitializer.js'

/**
 * @file app.ts
 * @description
 * Bootstrap lógico da aplicação:
 * - garante topologia do RabbitMQ
 * - inicia consumers (se esse container tiver papel de consumidor)
 *
 * ✅ Onde entra OPC UA aqui?
 * - Se este container for o COLETOR OPC UA, aqui você iniciaria o loop de leitura OPC UA
 *   e chamaria `publish(...)` a cada ciclo (em vez de iniciar consumer).
 * - Se este container for o CONSUMIDOR (DB/alerts), então o OPC UA não entra aqui,
 *   entra no container produtor.
 */

const log = pino({ name: env.APP_NAME })

/**
 * @function startApp
 * @description
 * Inicializa infraestrutura e inicia os processos principais da aplicação.
 */
export async function startApp() {
  await initializeOpcuaClientsFromJSON()
  await setupRabbitTopology()

  /**
   * Slug da area que este processo deve consumir.
   * Definido via env `CONSUMER_AREA_SLUG` (ex: "pasteurizacao").
   * Quando ausente, consome todas as filas (comportamento legado).
   */
  const areaSlug = process.env.CONSUMER_AREA_SLUG?.trim() || undefined
  await startTelemetryConsumer(areaSlug)
  await startAlertConsumer(areaSlug)

  log.info({ areaSlug: areaSlug ?? 'all' }, 'App started')
}
