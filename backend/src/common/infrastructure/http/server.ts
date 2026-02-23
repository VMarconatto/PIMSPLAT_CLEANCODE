/* eslint-disable prettier/prettier */
import "reflect-metadata"
import "../container/index.js"
import { app } from "./app.js"
import { env } from "../env/index.js"
import { dataSource } from "../typeorm/index.js"
import { initializeOpcuaClientsFromJSON, initializeOpcuaClientsFromDB } from "../../../telemetry/app/launchers/OpcuaInitializer.js"
import fs from "node:fs"
import path from "node:path"
import { container } from "tsyringe"
import type { StartCollectorUseCase } from "../../../telemetry/app/usecases/start-collector.usecase.js"

/**
 * @file server.ts
 * @description
 * Bootstrap do servidor.
 *
 * Responsabilidades:
 * - Garantir que o metadata reflection esteja ativo (necessário para TypeORM/tsyringe)
 * - Carregar o container de dependências (DI)
 * - Inicializar a conexão com o banco (TypeORM DataSource)
 * - Subir o servidor Express na porta definida em `env.PORT`
 * - Pré-registrar clientes OPC UA (DB-first, fallback JSON) — SEM conectar
 * - Aplicar auto-start do cliente padrão, se habilitado em `opcuaAutoStart.json`
 *
 * Observação:
 * - Este arquivo é o ponto de entrada "executável" da aplicação.
 * - O `app` fica separado em `app.ts` para facilitar testes.
 */

/** Caminho do arquivo de configuração de auto-start. */
const AUTOSTART_FILE = path.resolve(process.cwd(), "src", "opcuaAutoStart.json")

/**
 * Lê a configuração de auto-start sem lançar exceções.
 * Retorna defaults seguros se o arquivo não existir ou estiver corrompido.
 * Suporta formato legado { defaultClient: string } migrando para { defaultClients: string[] }.
 */
function readAutoStartConfig(): { autoStartEnabled: boolean; defaultClients: string[] } {
  try {
    if (!fs.existsSync(AUTOSTART_FILE)) return { autoStartEnabled: false, defaultClients: [] }
    const parsed = JSON.parse(fs.readFileSync(AUTOSTART_FILE, "utf-8"))

    let defaultClients: string[] = []
    if (Array.isArray(parsed.defaultClients)) {
      defaultClients = parsed.defaultClients.filter((v: unknown) => typeof v === "string" && (v as string).trim())
    } else if (typeof parsed.defaultClient === "string" && parsed.defaultClient.trim()) {
      defaultClients = [parsed.defaultClient.trim()]
    }

    return {
      autoStartEnabled: Boolean(parsed.autoStartEnabled),
      defaultClients,
    }
  } catch {
    return { autoStartEnabled: false, defaultClients: [] }
  }
}

console.log("[HTTP API] Iniciando servidor...")

dataSource
  .initialize()
  .then(async () => {
    console.log("[HTTP API] DataSource inicializado com sucesso")
    await dataSource.runMigrations()
    console.log("[HTTP API] Migrations executadas com sucesso")

    // ── 1. Pré-registrar clientes OPC UA (sem conectar) ──────────────────────
    try {
      const countFromDB = await initializeOpcuaClientsFromDB()
      if (countFromDB > 0) {
        console.log(`[HTTP API] OPC UA clients pré-registrados via banco de dados (${countFromDB} perfil(s) ativo(s))`)
      } else {
        console.log("[HTTP API] Nenhum perfil ativo no banco — usando fallback JSON")
        await initializeOpcuaClientsFromJSON()
        console.log("[HTTP API] OPC UA clients pré-registrados via JSON (fallback)")
      }
    } catch (e) {
      console.error("[HTTP API] Falha ao pré-registrar clientes OPC UA:")
      console.error(e)
    }

    // ── 2. Auto-start dos clientes marcados (se habilitado) ──────────────────
    try {
      const { autoStartEnabled, defaultClients } = readAutoStartConfig()
      if (autoStartEnabled && defaultClients.length > 0) {
        console.log(`[HTTP API] Auto-start habilitado. Iniciando ${defaultClients.length} cliente(s): ${defaultClients.join(", ")}`)
        const useCase = container.resolve<StartCollectorUseCase>("StartCollectorUseCase")
        const results = await Promise.allSettled(
          defaultClients.map((clientId) => useCase.execute({ clientId }))
        )
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          if (result.status === "fulfilled") {
            console.log(`[HTTP API] Auto-start: cliente '${defaultClients[i]}' iniciado com sucesso.`)
          } else {
            console.error(`[HTTP API] Auto-start: falha ao iniciar '${defaultClients[i]}':`, result.reason)
          }
        }
      } else {
        console.log("[HTTP API] Auto-start desabilitado ou sem clientes definidos.")
      }
    } catch (e) {
      console.error("[HTTP API] Falha ao aplicar auto-start (clientes continuarão parados):")
      console.error(e)
    }

    const server = app.listen(env.PORT)

    server.on("listening", () => {
      console.log(`[HTTP API] Escutando pela porta ${env.PORT}`)
      console.log("[HTTP API] API docs available at GET /docs")
    })

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[HTTP API] ERRO: porta ${env.PORT} já está em uso.`)
        console.error("[HTTP API] Encerre o processo que ocupa a porta e tente novamente.")
      } else {
        console.error("[HTTP API] Falha ao subir servidor:", err)
      }
      process.exit(1)
    })
  })
  .catch((e) => {
    console.error("[HTTP API] Erro ao inicializar o DataSource (TypeORM):")
    console.error(e)

    if (e instanceof AggregateError) {
      console.error("[HTTP API] AggregateError causes:")
      for (const err of e.errors) console.error(err)
    }

    process.exitCode = 1
  })
