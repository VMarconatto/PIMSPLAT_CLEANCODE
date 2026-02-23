/**
 * @file consumer.main.ts
 * @description
 * Ponto de entrada do processo **consumer-only worker** — processo dedicado
 * exclusivamente ao consumo de mensagens RabbitMQ, sem servir rotas HTTP.
 *
 * @remarks
 * **Responsabilidades do worker:**
 * 1. Configurar a topologia RabbitMQ (exchanges, queues e bindings) via
 *    {@link setupRabbitTopology}, garantindo que a infraestrutura de mensageria
 *    exista antes de iniciar o consumo.
 * 2. Iniciar o consumer de telemetria ({@link startTelemetryConsumer}) para
 *    processar mensagens OPC UA e persistir amostras no PostgreSQL.
 * 3. Iniciar o consumer de alertas ({@link startAlertConsumer}) para processar
 *    mensagens de alarme e acionar notificações.
 *
 * **Filtragem por área (`CONSUMER_AREA_SLUG`):**
 * Quando a variável de ambiente `CONSUMER_AREA_SLUG` está definida, o worker
 * processa apenas mensagens da área industrial correspondente (ex.: `'pasteurizacao'`,
 * `'utilidades'`). Quando ausente ou vazia, processa mensagens de **todas** as áreas.
 * Isso permite escalar horizontalmente com um worker dedicado por área industrial.
 *
 * **Variáveis de ambiente relevantes:**
 *
 * | Variável              | Obrigatória | Descrição                                                    |
 * |-----------------------|:-----------:|--------------------------------------------------------------|
 * | `CONSUMER_AREA_SLUG`  | Não         | Slug da área industrial a filtrar (ex.: `'pasteurizacao'`).  |
 * |                       |             | Omitir = processar todas as áreas.                           |
 * | `DB_HOST`             | Sim         | Host do servidor PostgreSQL (logado no startup).             |
 * | `DB_PORT`             | Sim         | Porta do PostgreSQL (logado no startup).                     |
 * | `DB_NAME`             | Sim         | Nome do banco de dados PostgreSQL (logado no startup).       |
 * | `RABBITMQ_URL`        | Sim         | URL de conexão ao RabbitMQ (usado por `setupRabbitTopology`).|
 *
 * **Tratamento de erros de inicialização:**
 * Qualquer rejeição não capturada durante o bootstrap é registrada via Pino
 * e o processo encerra com `exitCode = 1`, permitindo que o orquestrador de
 * containers (Docker, Kubernetes) detecte a falha e reinicie o worker.
 *
 * **Deploy típico:**
 * ```
 * node dist/messaging/consumer.main.js
 * # ou via Docker Compose com CONSUMER_AREA_SLUG=pasteurizacao
 * ```
 *
 * @module messaging/consumer.main
 */

import 'dotenv/config'
import pino from 'pino'
import { setupRabbitTopology } from './rabbitmq.setup.js'
import { startAlertConsumer, startTelemetryConsumer } from './consumer.js'

/**
 * Logger estruturado Pino para o processo consumer-only worker.
 *
 * @remarks
 * Identificado pelo nome `'consumer-main'` nos logs, permitindo distinguir
 * as mensagens deste processo dos demais serviços (ex.: `api-main`, `opcua-client`).
 * Utiliza a configuração padrão do Pino (JSON para stdout em produção).
 */
const log = pino({ name: 'consumer-main' })

/**
 * Função de bootstrap do consumer-only worker.
 *
 * @remarks
 * **Sequência de inicialização:**
 * 1. Lê e normaliza `CONSUMER_AREA_SLUG` (trim + conversão de string vazia para `undefined`).
 * 2. Registra as informações de contexto de inicialização (área, banco de dados).
 * 3. Configura a topologia RabbitMQ via {@link setupRabbitTopology}
 *    (exchanges, queues, bindings — idempotente).
 * 4. Inicia o consumer de telemetria via {@link startTelemetryConsumer},
 *    opcionalmente filtrado pela área definida em `CONSUMER_AREA_SLUG`.
 * 5. Inicia o consumer de alertas via {@link startAlertConsumer},
 *    opcionalmente filtrado pela área definida em `CONSUMER_AREA_SLUG`.
 * 6. Registra log de confirmação de inicialização bem-sucedida.
 *
 * @returns {Promise<void>} Resolve quando todos os consumers estão ativos e
 *   escutando suas respectivas filas RabbitMQ.
 *
 * @throws {Error} Quando a conexão com RabbitMQ ou PostgreSQL falha durante
 *   o bootstrap, ou quando a configuração da topologia não pode ser concluída.
 */
async function main(): Promise<void> {
  /**
   * Slug da área industrial filtrada por este worker.
   * `undefined` indica que todas as áreas serão processadas.
   */
  const areaSlug = process.env.CONSUMER_AREA_SLUG?.trim() || undefined

  log.info(
    {
      areaSlug: areaSlug ?? 'all',
      dbHost: process.env.DB_HOST,
      dbPort: process.env.DB_PORT,
      dbName: process.env.DB_NAME,
    },
    'Starting consumer-only worker',
  )

  await setupRabbitTopology()
  await startTelemetryConsumer(areaSlug)
  await startAlertConsumer(areaSlug)

  log.info({ areaSlug: areaSlug ?? 'all' }, 'Consumer-only worker started')
}

/**
 * Invoca o bootstrap e trata falhas de inicialização não capturadas.
 *
 * @remarks
 * Em caso de rejeição (erro lançado por {@link main}):
 * - Registra o erro completo com nível `error` via Pino, incluindo o stack trace.
 * - Define `process.exitCode = 1` para sinalizar falha ao orquestrador de containers
 *   (Docker, Kubernetes, PM2), que poderá reiniciar o worker automaticamente.
 * - Utiliza `exitCode` em vez de `process.exit(1)` para permitir que os
 *   callbacks de `process.on('exit')` sejam executados antes do encerramento.
 */
main().catch((err) => {
  log.error({ err }, 'Consumer-only worker failed to start')
  process.exitCode = 1
})
