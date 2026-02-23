/* eslint-disable no-console */

/**
 * @file start-stack.js
 * @description
 * Script de bootstrap da stack completa de desenvolvimento/produção do backend.
 *
 * @remarks
 * **Sequência de inicialização:**
 * 1. Sobe os containers de infraestrutura (`npm run infra:up` → Docker Compose).
 * 2. Compila o backend TypeScript (`npm run build`).
 * 3. Verifica se a porta HTTP (`PORT`, padrão: 3333) está livre.
 *    - Se ocupada, tenta limpeza automática (conforme {@link tryAutoCleanPort}).
 *    - Se ainda ocupada, aborta com código de saída `1`.
 * 4. Inicia o processo da **HTTP API** (`dist/common/infrastructure/http/server.js`).
 * 5. Aguarda a API ficar pronta (ouvindo na porta) via polling de `netstat`/`lsof`.
 * 6. Inicia o processo do **Coletor OPC UA** (`dist/telemetry/infrastructure/opcua/main.js`).
 * 7. Gerencia o ciclo de vida de ambos os processos filhos (sinais, falhas, restart).
 *
 * **Variáveis de ambiente:**
 *
 * | Variável                          | Padrão    | Descrição                                                              |
 * |-----------------------------------|-----------|------------------------------------------------------------------------|
 * | `PORT`                            | `3333`    | Porta TCP da HTTP API.                                                 |
 * | `STACK_AUTO_CLEAN_PORT`           | `true`    | Habilita limpeza automática da porta antes de iniciar.                 |
 * | `STACK_KILL_ANY_PROCESS_ON_PORT`  | `false`   | Quando `true`, mata qualquer processo na porta (não só os da stack).   |
 * | `STACK_KEEP_API_ON_COLLECTOR_FAIL`| `true`    | Mantém a HTTP API rodando se o coletor OPC UA falhar.                  |
 * | `STACK_RESTART_COLLECTOR`         | `false`   | Reinicia automaticamente o coletor após falha.                         |
 * | `STACK_COLLECTOR_RESTART_DELAY_MS`| `5000`    | Atraso em ms antes de reiniciar o coletor após falha.                  |
 * | `STACK_HTTP_READY_TIMEOUT_MS`     | `30000`   | Timeout máximo em ms aguardando a HTTP API ficar pronta.               |
 * | `STACK_HTTP_READY_POLL_MS`        | `250`     | Intervalo de polling em ms para verificar se a HTTP API está pronta.   |
 *
 * **Encerramento gracioso:**
 * Os sinais `SIGINT` (Ctrl+C) e `SIGTERM` enviam `SIGTERM` para todos os
 * processos filhos e aguardam 300 ms antes de encerrar o processo pai.
 *
 * **Compatibilidade:** Windows (`netstat`, `taskkill`, PowerShell) e Unix (`lsof`, `ps`, `SIGTERM`).
 *
 * @module scripts/start-stack
 */

const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const dotenv = require("dotenv");

/**
 * Diretório raiz do projeto — diretório de trabalho atual ao invocar o script.
 * Usado como `cwd` em todos os processos filhos e para resolução de caminhos.
 *
 * @type {string}
 */
const rootDir = process.cwd();

/**
 * Nome do executável npm correto para a plataforma atual.
 *
 * @remarks
 * No Windows, `npm` é um arquivo `.cmd` e precisa ser chamado como `npm.cmd`
 * ao usar `spawn` sem `shell: true` completo. Em Unix, `npm` resolve diretamente.
 *
 * @type {string}
 */
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

// Carrega variáveis de ambiente do arquivo .env na raiz do projeto
dotenv.config({ path: path.join(rootDir, ".env") });

/**
 * Verifica se uma porta TCP está livre tentando abrir um servidor nela.
 *
 * @remarks
 * Cria um servidor TCP temporário na porta especificada em `0.0.0.0`.
 * - Se o bind for bem-sucedido, fecha o servidor imediatamente e retorna `true`.
 * - Se ocorrer um erro (`EADDRINUSE` ou similar), retorna `false`.
 *
 * Esta verificação é complementar a {@link getListeningPidsOnPort}: a sondagem
 * por bind detecta portas ocupadas mesmo quando `netstat`/`lsof` não retornam PIDs
 * (ex.: TIME_WAIT, portas reservadas pelo sistema).
 *
 * @param {number} port - Número da porta TCP a verificar (1–65535).
 * @returns {Promise<boolean>} `true` se a porta está livre; `false` se está ocupada.
 */
function probePortFreeByBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

/**
 * Verifica se uma porta TCP está completamente livre para uso.
 *
 * @remarks
 * Combina duas verificações complementares:
 * 1. {@link getListeningPidsOnPort} — detecta processos em estado `LISTENING`
 *    via `netstat` (Windows) ou `lsof` (Unix).
 * 2. {@link probePortFreeByBind} — tenta abrir um servidor na porta para
 *    confirmar disponibilidade real de bind.
 *
 * Retorna `false` imediatamente se `getListeningPidsOnPort` encontrar processos,
 * evitando a tentativa de bind desnecessária.
 *
 * @param {number} port - Número da porta TCP a verificar.
 * @returns {Promise<boolean>} `true` se nenhum processo ocupa a porta e o bind é possível.
 */
async function isPortFree(port) {
  const listeners = getListeningPidsOnPort(port);
  if (listeners.length > 0) return false;
  return probePortFreeByBind(port);
}

/**
 * Executa um passo de build/setup como processo filho e aguarda sua conclusão.
 *
 * @remarks
 * O processo filho herda os streams `stdio` do processo pai (`stdio: "inherit"`),
 * exibindo sua saída diretamente no terminal. Usa `shell: true` para garantir
 * compatibilidade com comandos npm em diferentes plataformas.
 *
 * Rejeita a promise quando o processo encerra com código de saída diferente de `0`
 * ou quando ocorre erro de spawn (ex.: executável não encontrado).
 *
 * @param {string}   label   - Descrição legível do passo, usada no log e na mensagem de erro.
 * @param {string}   command - Executável a invocar (ex.: `'npm.cmd'`, `'docker'`).
 * @param {string[]} args    - Argumentos do comando (ex.: `['run', 'build']`).
 * @returns {Promise<void>} Resolve quando o processo encerra com código `0`.
 *
 * @throws {Error} Quando o processo encerra com código de saída não-zero ou falha ao iniciar.
 *
 * @example
 * ```js
 * await runStep('Buildando backend (build)', npmBin, ['run', 'build'])
 * ```
 */
function runStep(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`[start:stack] ${label}...`);

    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: true,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `[start:stack] Falha em "${label}" (code=${code ?? "null"}, signal=${
            signal ?? "null"
          })`
        )
      );
    });
  });
}

/**
 * Retorna uma promise que resolve após o número de milissegundos especificado.
 *
 * @param {number} ms - Tempo de espera em milissegundos.
 * @returns {Promise<void>} Resolve após `ms` milissegundos.
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Converte um valor bruto para número positivo ou retorna um fallback.
 *
 * @remarks
 * Rejeita valores que não sejam números finitos positivos (`NaN`, `Infinity`,
 * negativos, zero) retornando `fallback`. Usado para ler configurações numéricas
 * de variáveis de ambiente com valor padrão seguro.
 *
 * @param {unknown} rawValue - Valor bruto a converter (geralmente string de env var).
 * @param {number}  fallback - Valor padrão retornado quando `rawValue` é inválido.
 * @returns {number} Número finito positivo ou `fallback`.
 *
 * @example
 * ```js
 * parsePositiveNumberOrFallback(process.env.TIMEOUT_MS, 30000)
 * // → 30000 quando TIMEOUT_MS não está definido ou é inválido
 * ```
 */
function parsePositiveNumberOrFallback(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Verifica se uma linha de comando pertence ao processo da HTTP API.
 *
 * @remarks
 * Identifica o processo da HTTP API pelo caminho canônico do script compilado:
 * `dist/common/infrastructure/http/server.js`.
 * A comparação é feita de forma normalizada (barras convertidas, lowercase)
 * para funcionar em Windows (backslashes) e Unix (forward slashes).
 *
 * @param {string} cmdLine - Linha de comando completa do processo a verificar.
 * @returns {boolean} `true` se a linha de comando pertence à HTTP API.
 */
function isHttpApiProcess(cmdLine) {
  const normalized = (cmdLine || "").replaceAll("\\", "/").toLowerCase();
  return normalized.includes("dist/common/infrastructure/http/server.js");
}

/**
 * Formata a lista de PIDs donos de uma porta em string legível para logs.
 *
 * @remarks
 * Para cada PID, obtém a linha de comando via {@link getProcessCommandLine}
 * e formata como `"<pid> (<cmdline>)"`. PIDs sem linha de comando disponível
 * são exibidos com `"cmdline indisponível"`.
 *
 * @param {number[]} pids - Array de PIDs de processos em `LISTENING` na porta.
 * @returns {string} String formatada com todos os processos, separados por `"; "`.
 *   Retorna `"nenhum processo encontrado"` quando `pids` é vazio.
 *
 * @example
 * ```js
 * formatPortOwners([1234, 5678])
 * // → "1234 (node server.js); 5678 (python app.py)"
 * ```
 */
function formatPortOwners(pids) {
  if (pids.length === 0) return "nenhum processo encontrado";
  return pids
    .map((pid) => {
      const cmdLine = getProcessCommandLine(pid) || "cmdline indisponível";
      return `${pid} (${cmdLine})`;
    })
    .join("; ");
}

/**
 * Aguarda a HTTP API ficar pronta (ouvindo) na porta especificada via polling.
 *
 * @remarks
 * **Algoritmo de polling:**
 * A cada `pollIntervalMs`, verifica os PIDs em estado `LISTENING` na porta:
 * 1. Se o PID do `httpProcess` está na lista → API pronta, retorna o tempo decorrido.
 * 2. Se outro processo que parece ser a HTTP API está na lista
 *    (verificado via {@link isHttpApiProcess}) → considera pronta (processo recriado).
 * 3. Se um processo **diferente** da stack está na porta → lança erro imediatamente.
 * 4. Se `httpProcess.exitCode` não é `null` → API encerrou antes de ficar pronta.
 * 5. Se o timeout expira → lança erro com estado atual da porta.
 *
 * @param {number}                         port            - Porta TCP a monitorar.
 * @param {import('child_process').ChildProcess} httpProcess - Processo filho da HTTP API.
 * @param {number}                         timeoutMs       - Timeout máximo em milissegundos.
 * @param {number}                         pollIntervalMs  - Intervalo de polling em milissegundos.
 * @returns {Promise<number>} Tempo decorrido em ms até a API ficar pronta.
 *
 * @throws {Error} Quando a API encerra antes de ficar pronta.
 * @throws {Error} Quando outra aplicação (não da stack) ocupa a porta.
 * @throws {Error} Quando o timeout expira sem a API ficar pronta.
 */
async function waitForHttpReady(port, httpProcess, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (httpProcess.exitCode !== null) {
      throw new Error(
        `[start:stack] HTTP API encerrou antes de ficar pronta (exitCode=${httpProcess.exitCode}).`
      );
    }

    const listeners = getListeningPidsOnPort(port);
    if (listeners.includes(httpProcess.pid)) {
      return Date.now() - startedAt;
    }

    if (listeners.length > 0) {
      const ownedByHttpApi = listeners.some((pid) => isHttpApiProcess(getProcessCommandLine(pid)));
      if (ownedByHttpApi) {
        return Date.now() - startedAt;
      }

      throw new Error(
        `[start:stack] Porta ${port} está em LISTENING por outro processo: ${formatPortOwners(
          listeners
        )}`
      );
    }

    await wait(pollIntervalMs);
  }

  const listeners = getListeningPidsOnPort(port);
  throw new Error(
    `[start:stack] Timeout de ${timeoutMs}ms aguardando a HTTP API ouvir na porta ${port}. ` +
      `Estado atual da porta: ${formatPortOwners(listeners)}`
  );
}

/**
 * Retorna os PIDs de todos os processos em estado `LISTENING` numa porta TCP.
 *
 * @remarks
 * **Implementação por plataforma:**
 *
 * - **Windows:** Executa `netstat -ano -p tcp | findstr :<port>` via `cmd.exe`
 *   e parseia as linhas filtrando por `localAddress` terminando em `:<port>`
 *   e estado `LISTENING`. Retorna o PID da última coluna (campo 5).
 *
 * - **Unix (Linux/macOS):** Executa `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`
 *   que retorna diretamente um PID por linha para sockets em `LISTEN`.
 *
 * PIDs duplicados são deduplicados (via `Set` no Windows).
 * Retorna `[]` quando o comando falha ou não há processos na porta.
 *
 * @param {number} port - Número da porta TCP a consultar.
 * @returns {number[]} Array de PIDs únicos de processos em `LISTENING` na porta.
 *   Pode ser vazio se nenhum processo estiver usando a porta.
 */
function getListeningPidsOnPort(port) {
  if (process.platform === "win32") {
    const result = spawnSync("cmd", ["/c", `netstat -ano -p tcp | findstr :${port}`], {
      encoding: "utf8",
    });

    if (result.status !== 0 || !result.stdout) return [];

    const pids = new Set();
    for (const rawLine of result.stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;

      const localAddress = parts[1] || "";
      const state = (parts[3] || "").toUpperCase();
      const pid = Number(parts[4]);

      if (!localAddress.endsWith(`:${port}`)) continue;
      if (state !== "LISTENING") continue;
      if (!Number.isFinite(pid)) continue;

      pids.add(pid);
    }

    return [...pids];
  }

  // Unix: lsof retorna um PID por linha diretamente
  const result = spawnSync("sh", ["-lc", `lsof -nP -iTCP:${port} -sTCP:LISTEN -t`], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
}

/**
 * Retorna a linha de comando completa de um processo pelo seu PID.
 *
 * @remarks
 * **Implementação por plataforma:**
 *
 * - **Windows:** Usa PowerShell com `Get-CimInstance Win32_Process` para
 *   obter a propriedade `CommandLine` do processo. Retorna `""` em caso de falha.
 *
 * - **Unix (Linux/macOS):** Usa `ps -o command= -p <pid>` para obter a
 *   linha de comando sem o cabeçalho. Retorna `""` em caso de falha.
 *
 * O valor retornado é trimado. Nunca retorna `null` ou `undefined`.
 *
 * @param {number} pid - PID do processo a consultar.
 * @returns {string} Linha de comando do processo, ou `""` quando indisponível.
 */
function getProcessCommandLine(pid) {
  if (process.platform === "win32") {
    const psScript = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`;
    const result = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
      encoding: "utf8",
    });

    if (result.status !== 0) return "";
    return (result.stdout || "").trim();
  }

  const result = spawnSync("sh", ["-lc", `ps -o command= -p ${pid}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) return "";
  return (result.stdout || "").trim();
}

/**
 * Verifica se uma linha de comando pertence a algum processo da stack atual.
 *
 * @remarks
 * Identifica processos da stack pelos caminhos canônicos dos scripts:
 * - `dist/common/infrastructure/http/server.js` — HTTP API.
 * - `dist/telemetry/infrastructure/opcua/main.js` — Coletor OPC UA.
 * - `scripts/start-stack.js` — o próprio script de bootstrap.
 *
 * Usado por {@link tryAutoCleanPort} para decidir quais processos podem ser
 * encerrados automaticamente sem necessidade de `STACK_KILL_ANY_PROCESS_ON_PORT=true`.
 *
 * @param {string} cmdLine - Linha de comando completa do processo a verificar.
 * @returns {boolean} `true` se a linha de comando pertence a um processo da stack.
 */
function isStackProcess(cmdLine) {
  const normalized = (cmdLine || "").replaceAll("\\", "/").toLowerCase();
  return (
    normalized.includes("dist/common/infrastructure/http/server.js") ||
    normalized.includes("dist/telemetry/infrastructure/opcua/main.js") ||
    normalized.includes("scripts/start-stack.js")
  );
}

/**
 * Encerra um processo e toda a sua árvore de processos filhos.
 *
 * @remarks
 * **Implementação por plataforma:**
 *
 * - **Windows:** Usa `taskkill /PID <pid> /T /F` para forçar o encerramento
 *   recursivo de todo o processo tree (`/T`) sem confirmação (`/F`).
 *
 * - **Unix:** Envia `SIGTERM` ao PID via `process.kill()`. Erros (processo já
 *   encerrado, permissão negada) são capturados silenciosamente e retornam `false`.
 *
 * @param {number} pid - PID do processo raiz a encerrar.
 * @returns {boolean} `true` se o comando de encerramento foi executado com sucesso.
 *   `false` em caso de falha (processo não existe, permissão negada, etc.).
 */
function killPidTree(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("cmd", ["/c", `taskkill /PID ${pid} /T /F`], {
      encoding: "utf8",
    });
    return result.status === 0;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/**
 * Tenta liberar automaticamente uma porta TCP encerrando os processos que a ocupam.
 *
 * @remarks
 * **Fluxo:**
 * 1. Verifica se `STACK_AUTO_CLEAN_PORT !== "false"` — se desabilitado, retorna `false`.
 * 2. Lista os PIDs em `LISTENING` na porta via {@link getListeningPidsOnPort}.
 * 3. Para cada PID:
 *    - Se `STACK_KILL_ANY_PROCESS_ON_PORT=true`: encerra sem verificar a origem.
 *    - Caso contrário: encerra apenas processos da stack (via {@link isStackProcess}).
 *      PIDs de outros processos são apenas avisados no console.
 * 4. Se ao menos um processo foi encerrado, aguarda 1200 ms para o SO liberar a porta.
 *
 * **Variáveis de ambiente que controlam o comportamento:**
 * - `STACK_AUTO_CLEAN_PORT` — `"false"` desabilita toda a lógica (padrão: habilitado).
 * - `STACK_KILL_ANY_PROCESS_ON_PORT` — `"true"` permite matar qualquer processo (padrão: só da stack).
 *
 * @param {number} port - Número da porta TCP a liberar.
 * @returns {Promise<boolean>} `true` se ao menos um processo foi encerrado; `false` caso contrário.
 */
async function tryAutoCleanPort(port) {
  const autoCleanEnabled = process.env.STACK_AUTO_CLEAN_PORT !== "false";
  if (!autoCleanEnabled) return false;

  const allowAnyProcess = process.env.STACK_KILL_ANY_PROCESS_ON_PORT === "true";
  const pids = getListeningPidsOnPort(port);
  if (pids.length === 0) return false;

  console.warn(`[start:stack] Porta ${port} ocupada. Tentando limpeza automática...`);

  let killedAny = false;
  for (const pid of pids) {
    const cmdLine = getProcessCommandLine(pid);
    const shouldKill = allowAnyProcess || isStackProcess(cmdLine);

    if (!shouldKill) {
      console.warn(
        `[start:stack] PID ${pid} não parece ser da stack atual. ` +
          `Defina STACK_KILL_ANY_PROCESS_ON_PORT=true para forçar.`,
      );
      continue;
    }

    console.warn(`[start:stack] Encerrando PID ${pid} (${cmdLine || "cmdline indisponível"})`);
    const killed = killPidTree(pid);
    killedAny = killedAny || killed;
  }

  if (killedAny) {
    /** Aguarda o SO liberar a porta após o encerramento dos processos. */
    await wait(1200);
  }

  return killedAny;
}

/**
 * Inicia um serviço da stack como processo filho Node.js.
 *
 * @remarks
 * Usa `spawn("node", [scriptPath], { shell: false })` — sem shell intermediário —
 * para que o PID retornado seja o do processo Node.js diretamente, permitindo
 * rastreamento preciso em {@link waitForHttpReady} e {@link getListeningPidsOnPort}.
 *
 * Erros de spawn (ex.: script não encontrado) são registrados no console mas
 * não encerram o processo pai; o processo filho retornará `exitCode` não-zero.
 *
 * @param {string} name       - Nome legível do serviço, usado nos logs de erro.
 * @param {string} scriptPath - Caminho relativo ao `rootDir` do script a executar.
 * @returns {import('child_process').ChildProcess} Processo filho em execução.
 *
 * @example
 * ```js
 * const http = spawnService('HTTP API', './dist/common/infrastructure/http/server.js')
 * ```
 */
function spawnService(name, scriptPath) {
  const child = spawn("node", [scriptPath], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (err) => {
    console.error(`[start:stack] Erro ao iniciar ${name}:`, err);
  });

  return child;
}

/**
 * Função principal de bootstrap da stack.
 *
 * @remarks
 * Orquestra toda a sequência de inicialização descrita no cabeçalho do arquivo.
 * Define internamente duas closures de ciclo de vida:
 *
 * - **`stopAll(reason, exitCode)`:** Encerramento gracioso — envia `SIGTERM` para
 *   todos os processos filhos ativos e aguarda 300 ms antes de sair. Idempotente
 *   (guarda pelo flag `shuttingDown`).
 *
 * - **`spawnCollectorWithResilience(reason)`:** Inicia o coletor OPC UA com
 *   lógica de resiliência configurável via env vars:
 *   - `keepApiOnCollectorFailure=false` → encerra toda a stack quando o coletor cai.
 *   - `restartCollectorOnFailure=true` → reinicia o coletor após `collectorRestartDelayMs` ms.
 *   - Padrão → loga aviso e mantém apenas a HTTP API ativa.
 *
 * @returns {Promise<void>} Resolve quando o coletor OPC UA é iniciado com sucesso
 *   após a HTTP API estar pronta. Os processos filhos continuam rodando em background.
 *
 * @throws {Error} Quando `npm run infra:up` ou `npm run build` falham.
 * @throws Quando a porta HTTP permanece ocupada após a tentativa de limpeza.
 */
async function main() {
  await runStep("Subindo containers (infra:up)", npmBin, ["run", "infra:up"]);
  await runStep("Buildando backend (build)", npmBin, ["run", "build"]);

  /** Porta TCP da HTTP API — lida de `PORT` ou padrão 3333. */
  const port = Number(process.env.PORT) || 3333;
  let portFree = await isPortFree(port);
  if (!portFree) {
    await tryAutoCleanPort(port);
    portFree = await isPortFree(port);
  }

  if (!portFree) {
    console.error(
      `[start:stack] ERRO: porta ${port} já está em uso.\n` +
        `  Encerre o processo que está ocupando a porta e tente novamente.\n` +
      `  Windows: netstat -ano | findstr :${port}\n` +
      `  Linux/Mac: lsof -i :${port}`
    );
    process.exit(1);
  }

  console.log("[start:stack] Iniciando API HTTP e Coletor OPC UA...");

  /**
   * Quando `true`, mantém a HTTP API ativa mesmo que o coletor OPC UA falhe.
   * Controlado por `STACK_KEEP_API_ON_COLLECTOR_FAIL` (padrão: `true`).
   * @type {boolean}
   */
  const keepApiOnCollectorFailure = process.env.STACK_KEEP_API_ON_COLLECTOR_FAIL !== "false";

  /**
   * Quando `true`, reinicia automaticamente o coletor OPC UA após falha.
   * Controlado por `STACK_RESTART_COLLECTOR` (padrão: `false`).
   * @type {boolean}
   */
  const restartCollectorOnFailure = process.env.STACK_RESTART_COLLECTOR === "true";

  /**
   * Tempo de espera em ms antes de reiniciar o coletor após falha.
   * Controlado por `STACK_COLLECTOR_RESTART_DELAY_MS` (padrão: `5000`).
   * @type {number}
   */
  const collectorRestartDelayMs = Number(process.env.STACK_COLLECTOR_RESTART_DELAY_MS || 5000);

  /**
   * Timeout máximo em ms aguardando a HTTP API ficar pronta.
   * Controlado por `STACK_HTTP_READY_TIMEOUT_MS` (padrão: `30000`).
   * @type {number}
   */
  const httpReadyTimeoutMs = parsePositiveNumberOrFallback(
    process.env.STACK_HTTP_READY_TIMEOUT_MS,
    30000
  );

  /**
   * Intervalo de polling em ms para verificar se a HTTP API está pronta.
   * Controlado por `STACK_HTTP_READY_POLL_MS` (padrão: `250`).
   * @type {number}
   */
  const httpReadyPollIntervalMs = parsePositiveNumberOrFallback(
    process.env.STACK_HTTP_READY_POLL_MS,
    250
  );

  console.log(
    `[start:stack] Resiliencia: keepApiOnCollectorFailure=${keepApiOnCollectorFailure}, ` +
      `restartCollectorOnFailure=${restartCollectorOnFailure}, ` +
      `collectorRestartDelayMs=${collectorRestartDelayMs}`,
  );
  console.log(
    `[start:stack] Startup HTTP: timeout=${httpReadyTimeoutMs}ms, poll=${httpReadyPollIntervalMs}ms`,
  );

  /** Processo filho da HTTP API. */
  const http = spawnService("HTTP API", "./dist/common/infrastructure/http/server.js");

  /** Processo filho do Coletor OPC UA. Iniciado após a HTTP API estar pronta. */
  let collector = null;

  /** Flag para evitar encerramento duplicado (idempotência do `stopAll`). */
  let shuttingDown = false;

  /**
   * Encerra graciosamente todos os processos filhos da stack.
   *
   * @remarks
   * Idempotente: chamadas subsequentes são ignoradas via flag `shuttingDown`.
   * Envia `SIGTERM` para HTTP API e coletor (se ativos) e aguarda 300 ms
   * para que os processos finalizem antes de encerrar o processo pai.
   *
   * @param {string} reason   - Motivo do encerramento, usado no log.
   * @param {number} [exitCode=0] - Código de saída do processo pai.
   */
  const stopAll = (reason, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[start:stack] Encerrando stack (${reason})...`);

    if (http && http.exitCode === null && !http.killed) http.kill("SIGTERM");
    if (collector && collector.exitCode === null && !collector.killed) collector.kill("SIGTERM");

    /** Aguarda 300 ms para que os filhos processem o SIGTERM antes do exit. */
    setTimeout(() => process.exit(exitCode), 300);
  };

  // Registra handlers para sinais de encerramento do processo pai
  process.on("SIGINT", () => stopAll("SIGINT", 0));
  process.on("SIGTERM", () => stopAll("SIGTERM", 0));

  // Quando a HTTP API encerra inesperadamente, encerra toda a stack
  http.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[start:stack] HTTP API encerrou (code=${code ?? "null"}, signal=${signal ?? "null"})`
    );
    stopAll("HTTP API finalizou inesperadamente", code ?? 1);
  });

  /**
   * Inicia o coletor OPC UA com lógica de resiliência configurável.
   *
   * @remarks
   * Ao detectar encerramento do coletor (evento `exit`), aplica a política
   * definida pelas variáveis de ambiente:
   * - `keepApiOnCollectorFailure=false` → chama {@link stopAll} encerrando tudo.
   * - `restartCollectorOnFailure=true` → agenda reinicialização após `collectorRestartDelayMs` ms.
   * - Padrão → loga aviso e mantém apenas a HTTP API.
   *
   * @param {string} reason - Motivo do início, usado no log (ex.: `"startup"`, `"restart"`).
   * @returns {import('child_process').ChildProcess} Processo filho do coletor OPC UA.
   */
  const spawnCollectorWithResilience = (reason) => {
    console.log(`[start:stack] Iniciando OPC UA Collector (${reason})...`);
    const proc = spawnService("OPC UA Collector", "./dist/telemetry/infrastructure/opcua/main.js");

    proc.on("exit", (code, signal) => {
      if (shuttingDown) return;

      console.error(
        `[start:stack] OPC UA Collector encerrou (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      );

      if (!keepApiOnCollectorFailure) {
        stopAll("OPC UA Collector finalizou inesperadamente", code ?? 1);
        return;
      }

      if (restartCollectorOnFailure) {
        console.warn(
          `[start:stack] Coletor caiu; tentando reiniciar em ${collectorRestartDelayMs}ms...`,
        );
        setTimeout(() => {
          if (shuttingDown) return;
          collector = spawnCollectorWithResilience("restart");
        }, collectorRestartDelayMs);
        return;
      }

      console.warn("[start:stack] API HTTP permanecerá ativa sem o coletor OPC UA.");
    });

    return proc;
  };

  try {
    const elapsedMs = await waitForHttpReady(port, http, httpReadyTimeoutMs, httpReadyPollIntervalMs);
    console.log(
      `[start:stack] HTTP API pronta na porta ${port} (${elapsedMs}ms). Iniciando coletor...`,
    );
  } catch (err) {
    console.error("[start:stack] ERRO: HTTP API não ficou pronta no tempo esperado.");
    console.error("[start:stack] Verifique conexão com banco, migrations e logs da API.");
    console.error(err);
    stopAll("HTTP API não inicializou corretamente", 1);
    return;
  }

  collector = spawnCollectorWithResilience("startup");
}

/**
 * Invoca o bootstrap e trata falhas não capturadas.
 *
 * @remarks
 * Em caso de rejeição lançada por {@link main}:
 * - Registra o erro completo no console (stderr).
 * - Encerra o processo com `process.exit(1)`, sinalizando falha ao
 *   orquestrador de containers ou ao shell que invocou o script.
 */
main().catch((err) => {
  console.error("[start:stack] Falha no bootstrap da stack:");
  console.error(err);
  process.exit(1);
});
