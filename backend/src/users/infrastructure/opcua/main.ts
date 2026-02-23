import "dotenv/config";

import { setupRabbitTopology } from "../../../messaging/rabbitmq.setup.js";
import { startTelemetryConsumer, startAlertConsumer } from "../../../messaging/consumer.js";
import { initializeOpcuaClientsFromJSON } from "../../../telemetry/app/launchers/OpcuaInitializer.js";
import { publish } from "../../../messaging/publisher.js";

/**
 * @file main.ts
 * @module runtime/main
 *
 * @description
 * Entry-point (bootstrap) da aplicação **OPC UA MultiClient + RabbitMQ**.
 *
 * Este arquivo é o **orquestrador de inicialização** do runtime:
 * ele coordena, na ordem correta, a subida da topologia RabbitMQ,
 * o início do worker consumer (modo validação) e a inicialização
 * dos OPC UA Clients.
 *
 * ───────────────────────────────────────────────────────────────
 * 🎯 Objetivo do main
 * ───────────────────────────────────────────────────────────────
 * Garantir que os subsistemas críticos iniciem com previsibilidade:
 *
 * 1) Topologia do RabbitMQ (exchange/queues/bindings/DLQ/retry)
 * 2) Consumer "de validação" (opcional / útil em dev e smoke-tests)
 * 3) Inicialização dos OPC UA clients (loop ativo de conexão/coleta)
 * 4) Publicação de mensagens de teste (opcional / modo diagnóstico)
 *
 * ───────────────────────────────────────────────────────────────
 * 🧩 Contexto Arquitetural
 * ───────────────────────────────────────────────────────────────
 * - Producer (OPC UA MultiClient) publica telemetria em RabbitMQ
 * - RabbitMQ roteia mensagens para filas duráveis
 * - Consumer (worker) consome e processa (no futuro: persistência em DB)
 *
 * ⚠ Importante:
 * Este main sobe um consumer "de validação" que APENAS imprime as mensagens.
 * Ele NÃO é o banco de dados.
 * O banco será plugado depois, como handler real dentro do consumer.
 *
 * ───────────────────────────────────────────────────────────────
 * 🧪 Modo "Validação de Pipeline"
 * ───────────────────────────────────────────────────────────────
 * O consumer aqui é intencionalmente simples para permitir:
 * - validar a topologia do Rabbit
 * - validar routingKey / bindings
 * - inspecionar o envelope (telemetry v1)
 * - observar volume e frequência
 *
 * Ao evoluir para produção, este handler será substituído por:
 * - persistência Postgres/Mongo
 * - regras de idempotência
 * - métricas / tracing
 *
 * ───────────────────────────────────────────────────────────────
 * 🔐 Requisitos e Pré-condições
 * ───────────────────────────────────────────────────────────────
 * - Variáveis de ambiente devem estar carregadas (dotenv/config).
 * - RabbitMQ deve estar acessível conforme config (host/port/user/pass).
 * - O arquivo JSON de setup do MultiClient deve existir (initializer).
 *
 * ───────────────────────────────────────────────────────────────
 * ⚠ Efeitos Colaterais (Side Effects)
 * ───────────────────────────────────────────────────────────────
 * - startConsumer() cria consumo contínuo (processo "fica rodando").
 * - initializeOpcuaClientsFromJSON() ativa loops de conexão e polling.
 * - setInterval() (modo test publish) gera tráfego contínuo no broker.
 *
 * ───────────────────────────────────────────────────────────────
 * 🧠 Observabilidade
 * ───────────────────────────────────────────────────────────────
 * Este main faz logs de variáveis-chave e marcos de boot:
 * - ENV (flags relevantes do Rabbit)
 * - "topology ready"
 * - "consumer started"
 * - "opcua initialized"
 * - "test publish enabled/disabled"
 *
 * Para produção, recomenda-se:
 * - substituir console por logger estruturado (pino)
 * - correlacionar mensagens via msgId / clientId
 */

/**
 * Bootstrap principal da aplicação.
 *
 * @remarks
 * A ordem de inicialização não é “cosmética”:
 *
 * - Subir a topologia primeiro evita:
 *   - publish em exchange inexistente
 *   - mensagens indo para nowhere (sem bindings)
 *
 * - Iniciar consumer antes (em dev/test) ajuda:
 *   - drenar fila rapidamente
 *   - evitar acúmulo e falsa impressão de “travou”
 *
 * - Inicializar OPC UA por último garante que, quando o Producer começar
 *   a publicar telemetria, o Rabbit já está preparado.
 *
 * @returns Promise<void>
 * O processo tende a permanecer ativo devido aos loops internos
 * (consumer + opcua polling).
 *
 * @throws
 * Erros de conexão/config podem ocorrer em:
 * - setupRabbitTopology()
 * - startConsumer()
 * - initializeOpcuaClientsFromJSON()
 */
async function main(): Promise<void> {
  console.log("[BOOT] ENV:", {
    OPCUA_ENABLE_RABBIT: process.env.OPCUA_ENABLE_RABBIT,
    RABBITMQ_ROUTING_KEY: process.env.RABBITMQ_ROUTING_KEY,
    RABBIT_ROUTING_KEY_PREFIX: process.env.RABBIT_ROUTING_KEY_PREFIX,
    RABBIT_TEST_PUBLISH: process.env.RABBIT_TEST_PUBLISH,
  });

  // ── 1. Topologia RabbitMQ (pre-requisito para tudo) ──
  try {
    await setupRabbitTopology();
    console.log("[BOOT] Rabbit topology ready.");
  } catch (e) {
    console.error("[BOOT] FALHA ao configurar topologia RabbitMQ:", e);
    process.exitCode = 1;
    return;
  }

  const areaSlug = process.env.CONSUMER_AREA_SLUG?.trim() || undefined;

  // ── 2. Consumer de telemetria (independente) ──
  try {
    console.log("[BOOT] Iniciando telemetry consumer...");
    await startTelemetryConsumer(areaSlug);
    console.log("[BOOT] Telemetry consumer started.");
  } catch (e) {
    console.error("[BOOT] FALHA ao iniciar telemetry consumer:", e);
  }

  // ── 3. Consumer de alertas (independente) ──
  try {
    console.log("[BOOT] Iniciando alert consumer...");
    await startAlertConsumer(areaSlug);
    console.log("[BOOT] Alert consumer started.");
  } catch (e) {
    console.error("[BOOT] FALHA ao iniciar alert consumer:", e);
  }

  // ── 4. OPC UA clients (independente dos consumers) ──
  try {
    await initializeOpcuaClientsFromJSON();
    console.log("[BOOT] OPC UA clients inicializados (loop de conexao ativo).");
  } catch (e) {
    console.error("[BOOT] FALHA ao iniciar OPC UA:", e);
    process.exitCode = 1;
  }

  // ── 5. Publish de teste (opcional) ──
  if (process.env.RABBIT_TEST_PUBLISH === "true") {
    console.log("[BOOT] RABBIT_TEST_PUBLISH=true -> publicando mensagens de teste");
    setInterval(async () => {
      await publish("telemetry.utilidades.test", {
        type: "telemetry.test",
        version: 1,
        payload: {
          msgId: `test-${Date.now()}`,
          ts: new Date().toISOString(),
          site: "SITE",
          line: "LINE",
          hostId: "HOST",
          clientId: "TEST",
          tags: { ping: true, n: Math.random() },
        },
      });
    }, 5000);
  } else {
    console.log("[BOOT] Publish de teste desativado (defina RABBIT_TEST_PUBLISH=true se quiser validar).");
  }
}

/**
 * Dispara bootstrap.
 *
 * @remarks
 * Mantido fora da função para:
 * - clareza de "entry point"
 * - facilitar testes futuros (ex: export main e chamar em testes)
 */
main();
