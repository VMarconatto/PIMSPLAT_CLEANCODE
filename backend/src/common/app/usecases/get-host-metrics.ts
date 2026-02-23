/* eslint-disable prettier/prettier */

/**
 * @file get-host-metrics.ts
 * @description
 * Caso de uso responsável por coletar e consolidar métricas em tempo real
 * do host onde o backend está em execução.
 *
 * @remarks
 * **Métricas coletadas:**
 * - **CPU:** uso percentual total e por núcleo (delta entre leituras de ticks),
 *   mais load average de 1/5/15 min (apenas Unix).
 * - **Memória:** uso percentual, total e livre em GB.
 * - **Disco:** uso percentual, espaço livre e total por ponto de montagem
 *   (apenas Linux, via `/proc/mounts` + `statfs`).
 * - **Rede:** throughput em kbps (RX/TX) e contadores de erros
 *   (apenas Linux, via `/proc/net/dev`).
 * - **Processo Node.js:** uso de CPU do processo, RSS em MB e lag do event loop.
 * - **Sistema:** uptime, hostname, plataforma e arquitetura.
 *
 * **Padrão de medição por delta:**
 * CPU (host e processo) e throughput de rede são calculados como a diferença
 * entre duas leituras consecutivas de contadores. O estado anterior é mantido
 * em variáveis de módulo (`previousCpuCores`, `previousProcSample`, `previousNetSample`).
 * Na primeira chamada de `execute`, esses valores retornam `0` (sem histórico).
 *
 * **Compatibilidade de plataforma:**
 * - Disco e rede: somente Linux.
 * - Load average: somente Unix (Linux/macOS); `undefined` no Windows.
 * - As demais métricas funcionam em Linux, macOS e Windows.
 *
 * @module common/app/usecases/get-host-metrics
 */

import os from 'os'
import { performance } from 'perf_hooks'
import { promises as fs } from 'fs'

/**
 * Snapshot consolidado das métricas do host em um instante de tempo.
 *
 * @remarks
 * Retornado por {@link GetHostMetricsUseCase.execute} a cada chamada.
 * Todos os valores percentuais são expressos como fração `[0, 1]`
 * (ex.: `0.75` = 75% de uso).
 *
 * @property {string} timestamp
 *   Data/hora da coleta no formato ISO 8601 UTC.
 *
 * @property {object} cpu
 *   Métricas de uso de CPU do host.
 *
 * @property {number} cpu.pct
 *   Uso médio de CPU de todos os núcleos como fração `[0, 1]`.
 *   Calculado como média aritmética de `cpu.perCore`.
 *
 * @property {number[]} cpu.perCore
 *   Uso de CPU por núcleo lógico como fração `[0, 1]`.
 *   O índice `i` corresponde ao núcleo `i` retornado por `os.cpus()`.
 *
 * @property {{ one?: number; five?: number; fifteen?: number }} [cpu.load]
 *   Load average do sistema operacional nos últimos 1, 5 e 15 minutos.
 *   Disponível apenas em plataformas Unix (Linux, macOS).
 *   `undefined` no Windows.
 *
 * @property {object} mem
 *   Métricas de uso de memória RAM do host.
 *
 * @property {number} mem.usedPct
 *   Proporção de memória RAM em uso como fração `[0, 1]`.
 *
 * @property {number} mem.totalGB
 *   Total de memória RAM disponível no host em gigabytes.
 *
 * @property {number} mem.freeGB
 *   Memória RAM livre (disponível para alocação) em gigabytes.
 *
 * @property {{ total: number; used: number }} [mem.swapGB]
 *   Uso de memória swap em gigabytes. Campo reservado para implementação futura;
 *   atualmente não é populado pelo caso de uso.
 *
 * @property {Array<{ mount: string; usedPct: number; freeGB: number; sizeGB: number }>} disk
 *   Lista de pontos de montagem reais do sistema de arquivos com suas métricas.
 *   Disponível apenas em Linux (via `/proc/mounts` + `statfs`).
 *   Retorna array vazio em outras plataformas ou em caso de erro de leitura.
 *   - `mount` — caminho do ponto de montagem (ex.: `'/'`, `'/data'`).
 *   - `usedPct` — espaço utilizado como fração `[0, 1]`.
 *   - `freeGB` — espaço disponível para escrita em gigabytes.
 *   - `sizeGB` — capacidade total do volume em gigabytes.
 *
 * @property {object} net
 *   Métricas de rede do host.
 *
 * @property {{ opcua?: number; mongodb?: number }} net.latencyMs
 *   Latências de rede para serviços dependentes (OPC UA, MongoDB) em milissegundos.
 *   Campo reservado para implementação futura; retornado como objeto vazio `{}`.
 *
 * @property {{ rxKbps: number; txKbps: number }} net.throughput
 *   Throughput de rede em kilobits por segundo (calculado como delta entre leituras).
 *   - `rxKbps` — taxa de recepção (download).
 *   - `txKbps` — taxa de transmissão (upload).
 *   Disponível apenas em Linux; retorna `{ rxKbps: 0, txKbps: 0 }` em outras plataformas.
 *
 * @property {{ in?: number; out?: number }} [net.errors]
 *   Contadores acumulados de erros de rede por interface (exceto loopback).
 *   Disponível apenas em Linux; `undefined` em outras plataformas.
 *
 * @property {object} process
 *   Métricas do processo Node.js em execução.
 *
 * @property {number} process.cpuPct
 *   Uso de CPU do processo Node.js como fração `[0, 1]` (normalizado pelo número de cores).
 *
 * @property {number} process.rssMB
 *   Resident Set Size (RSS) do processo Node.js em megabytes.
 *   Representa a memória física alocada pelo processo no momento da coleta.
 *
 * @property {number} process.eventLoopLagMs
 *   Atraso do event loop do Node.js em milissegundos, medido via `setTimeout`.
 *   Valores altos (> 10 ms) indicam bloqueio do event loop por operações síncronas.
 *
 * @property {object} system
 *   Informações estáticas do sistema operacional e hardware.
 *
 * @property {number} system.uptimeSec
 *   Tempo em segundos desde a última inicialização do sistema operacional.
 *
 * @property {string} system.host
 *   Nome do host (hostname) do servidor, conforme `os.hostname()`.
 *
 * @property {string} system.platform
 *   Plataforma do sistema operacional (ex.: `'linux'`, `'win32'`, `'darwin'`).
 *
 * @property {string} system.arch
 *   Arquitetura do processador (ex.: `'x64'`, `'arm64'`).
 */
type HostSnapshot = {
  timestamp: string
  cpu: {
    pct: number
    perCore: number[]
    load?: { one?: number; five?: number; fifteen?: number }
  }
  mem: {
    usedPct: number
    totalGB: number
    freeGB: number
    swapGB?: { total: number; used: number }
  }
  disk: Array<{
    mount: string
    usedPct: number
    freeGB: number
    sizeGB: number
  }>
  net: {
    latencyMs: { opcua?: number; mongodb?: number }
    throughput: { rxKbps: number; txKbps: number }
    errors?: { in?: number; out?: number }
  }
  process: { cpuPct: number; rssMB: number; eventLoopLagMs: number }
  system: { uptimeSec: number; host: string; platform: string; arch: string }
}

/**
 * Leitura de ticks do sistema operacional para um núcleo de CPU em um instante.
 *
 * @remarks
 * Usada para calcular o delta de uso entre duas capturas consecutivas.
 * Os valores são acumulativos desde o boot do sistema (contadores monotônicos).
 *
 * @property {number} idle  - Ticks acumulados em estado ocioso (sem processamento).
 * @property {number} total - Soma de todos os ticks (user + nice + sys + idle + irq).
 */
type CpuCoreSample = {
  idle: number
  total: number
}

/**
 * Amostra de uso de CPU do processo Node.js em um instante específico.
 *
 * @remarks
 * Utilizada para calcular o delta de consumo de CPU do processo entre
 * duas chamadas consecutivas, usando tempo de alta resolução (`hrtime.bigint`)
 * para maior precisão que `Date.now()`.
 *
 * @property {NodeJS.CpuUsage} usage - Snapshot de `process.cpuUsage()`:
 *   contadores acumulados de tempo de CPU em microssegundos (`user` e `system`).
 * @property {bigint}          hrNs  - Timestamp de alta resolução em nanossegundos
 *   (`process.hrtime.bigint()`), usado para calcular o intervalo de tempo decorrido.
 */
type ProcSample = {
  usage: NodeJS.CpuUsage
  hrNs: bigint
}

/**
 * Amostra de contadores de tráfego de rede em um instante específico.
 *
 * @remarks
 * Mantida em {@link previousNetSample} para cálculo do delta de throughput
 * entre duas leituras consecutivas de `/proc/net/dev`.
 *
 * @property {number} timestampMs - Epoch em milissegundos do momento da captura.
 * @property {number} rxBytes     - Total acumulado de bytes recebidos (RX) pelas interfaces.
 * @property {number} txBytes     - Total acumulado de bytes transmitidos (TX) pelas interfaces.
 */
type NetSample = {
  timestampMs: number
  rxBytes: number
  txBytes: number
}

/**
 * Contadores brutos de tráfego e erros de rede lidos de `/proc/net/dev`.
 *
 * @remarks
 * Somados de todas as interfaces de rede físicas (exceto `lo` — loopback).
 * Contadores são acumulativos desde o boot; o throughput real é calculado
 * pelo delta entre duas leituras via {@link computeNetworkThroughput}.
 *
 * @property {number} rxBytes  - Total de bytes recebidos por todas as interfaces.
 * @property {number} txBytes  - Total de bytes transmitidos por todas as interfaces.
 * @property {number} rxErrors - Total de erros de recepção por todas as interfaces.
 * @property {number} txErrors - Total de erros de transmissão por todas as interfaces.
 */
type NetCounters = {
  rxBytes: number
  txBytes: number
  rxErrors: number
  txErrors: number
}

/** Número de bytes em 1 gigabyte (1024³). Usado para conversão de unidades. */
const BYTES_IN_GB = 1024 * 1024 * 1024

/** Número de bytes em 1 megabyte (1024²). Usado para conversão do RSS do processo. */
const BYTES_IN_MB = 1024 * 1024

/**
 * Última leitura de ticks de CPU por núcleo.
 *
 * @remarks
 * Inicializado como `null`; populado na primeira chamada de {@link computeCpuFractions}.
 * Na primeira chamada, retorna `0` para todos os núcleos (sem histórico para delta).
 */
let previousCpuCores: CpuCoreSample[] | null = null

/**
 * Última amostra de uso de CPU do processo Node.js.
 *
 * @remarks
 * Inicializado como `null`; populado na primeira chamada de {@link computeProcessCpuFraction}.
 * Na primeira chamada, retorna `0` (sem histórico para delta).
 */
let previousProcSample: ProcSample | null = null

/**
 * Última amostra de contadores de tráfego de rede.
 *
 * @remarks
 * Inicializado como `null`; populado na primeira chamada de {@link computeNetworkThroughput}.
 * Na primeira chamada, retorna `{ rxKbps: 0, txKbps: 0 }` (sem histórico para delta).
 */
let previousNetSample: NetSample | null = null

/**
 * Clampeia um número para o intervalo `[0, 1]`, descartando valores inválidos.
 *
 * @remarks
 * Valores `NaN`, `Infinity` ou `-Infinity` são convertidos para `0`.
 * Valores abaixo de `0` são elevados para `0`; acima de `1` são reduzidos a `1`.
 * Utilizado para garantir que todas as frações de uso permaneçam em `[0, 1]`.
 *
 * @param {number} value - Valor numérico a ser clampeado.
 * @returns {number} Valor dentro do intervalo `[0, 1]`.
 */
const toFraction = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * Captura os contadores acumulados de ticks de CPU para cada núcleo lógico.
 *
 * @remarks
 * Lê `os.cpus()` e computa para cada núcleo:
 * - `total` = soma de `user + nice + sys + idle + irq`.
 * - `idle` = ticks em estado ocioso.
 *
 * Os valores são acumulativos desde o boot (monotônicos), adequados para
 * calcular deltas percentuais entre duas leituras consecutivas.
 *
 * @returns {CpuCoreSample[]}
 *   Array com um {@link CpuCoreSample} por núcleo lógico, na mesma ordem de `os.cpus()`.
 */
function captureCpuCores(): CpuCoreSample[] {
  return os.cpus().map((core) => {
    const total =
      core.times.user +
      core.times.nice +
      core.times.sys +
      core.times.idle +
      core.times.irq
    return { idle: core.times.idle, total }
  })
}

/**
 * Calcula o uso de CPU do host como fração `[0, 1]`, total e por núcleo.
 *
 * @remarks
 * **Algoritmo de delta:**
 * 1. Captura os contadores atuais via {@link captureCpuCores}.
 * 2. Para cada núcleo `i`, calcula:
 *    - `totalDelta = current[i].total − prev[i].total`
 *    - `idleDelta  = current[i].idle  − prev[i].idle`
 *    - `usageFraction = (totalDelta − idleDelta) / totalDelta`
 * 3. Clampeia cada fração para `[0, 1]` via {@link toFraction}.
 * 4. Calcula `total` como a média aritmética das frações por núcleo.
 * 5. Atualiza `previousCpuCores` com a leitura atual.
 *
 * **Primeira chamada:** Inicializa `previousCpuCores` e retorna `{ total: 0, perCore: [0, ...] }`
 * (sem histórico para calcular delta).
 *
 * **Mudança de núcleos:** Se o número de núcleos mudar entre leituras
 * (evento raro em sistemas com CPU hotplug), reinicia o histórico e retorna zeros.
 *
 * @returns {{ total: number; perCore: number[] }}
 *   - `total` — uso médio de CPU de todos os núcleos como fração `[0, 1]`.
 *   - `perCore` — array de frações por núcleo lógico `[0, 1]`.
 */
function computeCpuFractions(): { total: number; perCore: number[] } {
  const current = captureCpuCores()
  if (!previousCpuCores || previousCpuCores.length !== current.length) {
    previousCpuCores = current
    return { total: 0, perCore: current.map(() => 0) }
  }

  const perCore = current.map((sample, index) => {
    const prev = previousCpuCores?.[index]
    if (!prev) return 0

    const totalDelta = sample.total - prev.total
    const idleDelta = sample.idle - prev.idle
    if (!Number.isFinite(totalDelta) || totalDelta <= 0) return 0

    return toFraction((totalDelta - idleDelta) / totalDelta)
  })

  previousCpuCores = current
  const total =
    perCore.length > 0
      ? toFraction(perCore.reduce((sum, value) => sum + value, 0) / perCore.length)
      : 0

  return { total, perCore }
}

/**
 * Calcula o uso de CPU do processo Node.js como fração `[0, 1]`.
 *
 * @remarks
 * **Algoritmo:**
 * 1. Captura `process.cpuUsage()` (user + system em microssegundos) e
 *    `process.hrtime.bigint()` (tempo de alta resolução em nanossegundos).
 * 2. Calcula o delta de CPU em microssegundos desde a última captura:
 *    `usageDeltaMicros = (user − prevUser) + (system − prevSystem)`.
 * 3. Calcula o intervalo decorrido em microssegundos:
 *    `elapsedMicros = (hrNs − prevHrNs) / 1000`.
 * 4. Normaliza pelo número de núcleos lógicos para representar a fração real
 *    do host utilizada (não apenas do processo):
 *    `fraction = usageDeltaMicros / (elapsedMicros × cpuCount)`.
 * 5. Atualiza `previousProcSample` com a leitura atual.
 *
 * **Primeira chamada:** Inicializa `previousProcSample` e retorna `0`.
 *
 * @returns {number} Fração `[0, 1]` do tempo de CPU do host consumida pelo processo Node.js.
 */
function computeProcessCpuFraction(): number {
  const usage = process.cpuUsage()
  const hrNs = process.hrtime.bigint()
  const cpuCount = Math.max(1, os.cpus().length)

  if (!previousProcSample) {
    previousProcSample = { usage, hrNs }
    return 0
  }

  const usageDeltaMicros =
    usage.user -
    previousProcSample.usage.user +
    (usage.system - previousProcSample.usage.system)
  const elapsedMicros = Number(hrNs - previousProcSample.hrNs) / 1000

  previousProcSample = { usage, hrNs }

  if (!Number.isFinite(elapsedMicros) || elapsedMicros <= 0) return 0
  return toFraction(usageDeltaMicros / (elapsedMicros * cpuCount))
}

/**
 * Mede o atraso do event loop do Node.js em milissegundos.
 *
 * @remarks
 * **Metodologia:**
 * Agenda um `setTimeout` com delay de `sampleWindowMs` ms e mede o tempo real
 * decorrido até o callback ser invocado. O lag é a diferença entre o tempo
 * medido e o delay solicitado:
 * ```
 * lag = (performance.now() após setTimeout) − started − sampleWindowMs
 * ```
 *
 * Valores negativos (clock drift) são truncados para `0`.
 * Valores `NaN` ou `Infinity` (clock inválido) são retornados como `0`.
 *
 * **Interpretação:**
 * - `lag < 5 ms` — event loop saudável.
 * - `5–50 ms` — carga moderada ou operações síncronas ocasionais.
 * - `> 50 ms` — possível bloqueio do event loop; investigar operações síncronas longas.
 *
 * @param sampleWindowMs - Duração da janela de amostragem em ms.
 *   Valores maiores reduzem o ruído de medição, mas aumentam a latência da coleta.
 *
 * @returns Lag do event loop em milissegundos (≥ 0).
 */
async function measureEventLoopLagMs(sampleWindowMs = 50): Promise<number> {
  const started = performance.now()
  await new Promise((resolve) => setTimeout(resolve, sampleWindowMs))
  const lag = performance.now() - started - sampleWindowMs
  if (!Number.isFinite(lag)) return 0
  return Math.max(0, lag)
}

/**
 * Lê os contadores de tráfego de rede de `/proc/net/dev` (Linux).
 *
 * @remarks
 * **Formato de `/proc/net/dev`:**
 * Cada linha (a partir da 3ª) descreve uma interface de rede com campos separados por espaço:
 * ```
 * Interface: rxBytes rxPkts rxErr rxDrop ... txBytes txPkts txErr txDrop ...
 * ```
 * Os campos relevantes são (0-indexed na parte de stats):
 * - `fields[0]`  → rxBytes
 * - `fields[2]`  → rxErrors
 * - `fields[8]`  → txBytes
 * - `fields[10]` → txErrors
 *
 * A interface `lo` (loopback) é excluída da soma.
 * Interfaces sem separador `:` são ignoradas.
 *
 * @returns {Promise<NetCounters | null>}
 *   Contadores somados de todas as interfaces físicas, ou `null` em caso de
 *   falha de leitura do arquivo (permissão negada, plataforma incompatível, etc.).
 */
async function readLinuxNetCounters(): Promise<NetCounters | null> {
  try {
    const raw = await fs.readFile('/proc/net/dev', 'utf8')
    const lines = raw.split('\n').slice(2)

    let rxBytes = 0
    let txBytes = 0
    let rxErrors = 0
    let txErrors = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes(':')) continue

      const [ifaceRaw, statsRaw] = trimmed.split(':')
      const iface = ifaceRaw.trim()
      if (!iface || iface === 'lo') continue

      const fields = statsRaw.trim().split(/\s+/)
      if (fields.length < 11) continue

      rxBytes += Number(fields[0] ?? 0) || 0
      rxErrors += Number(fields[2] ?? 0) || 0
      txBytes += Number(fields[8] ?? 0) || 0
      txErrors += Number(fields[10] ?? 0) || 0
    }

    return { rxBytes, txBytes, rxErrors, txErrors }
  } catch {
    return null
  }
}

/**
 * Retorna os contadores de rede adequados à plataforma atual.
 *
 * @remarks
 * Wrapper que abstrai a leitura de contadores de rede de forma portável:
 * - **Linux:** Delega para {@link readLinuxNetCounters} (`/proc/net/dev`).
 * - **Demais plataformas** (Windows, macOS): Retorna `null` — coleta não suportada.
 *
 * @returns {Promise<NetCounters | null>}
 *   Contadores de rede ou `null` quando a plataforma não é suportada
 *   ou ocorre falha na leitura.
 */
async function readNetCounters(): Promise<NetCounters | null> {
  if (process.platform === 'linux') {
    return readLinuxNetCounters()
  }
  return null
}

/**
 * Lê informações de disco de todos os pontos de montagem reais (Linux).
 *
 * @remarks
 * **Fonte de dados:** `/proc/mounts` lista todos os sistemas de arquivos montados.
 * Para cada ponto de montagem (excluindo pseudo-filesystems), `fs.statfs` retorna
 * os contadores de blocos para cálculo de espaço.
 *
 * **Filtros aplicados:**
 * - Mounts iniciando com `/proc`, `/sys` ou `/dev` são ignorados
 *   (pseudo-filesystems do kernel).
 * - Mounts duplicados são ignorados (via `Set`).
 * - Volumes com tamanho zero ou inválido são ignorados.
 * - Erros de `statfs` individuais (permissão negada, filesystem desmontado)
 *   são ignorados silenciosamente — os demais mounts continuam sendo processados.
 *
 * **Cálculo:**
 * - `sizeBytes = stat.blocks × stat.bsize`
 * - `freeBytes = stat.bavail × stat.bsize` (espaço disponível para usuários não-root)
 * - `usedPct = (sizeBytes − freeBytes) / sizeBytes`
 *
 * **Plataforma:** Retorna `[]` em plataformas não-Linux (Windows, macOS).
 *
 * @returns {Promise<HostSnapshot['disk']>}
 *   Array de objetos com `mount`, `usedPct`, `freeGB` e `sizeGB` por volume.
 *   Retorna `[]` em plataformas não-Linux ou em caso de falha geral de leitura.
 */
async function readDiskSnapshot(): Promise<HostSnapshot['disk']> {
  if (process.platform !== 'linux') {
    return []
  }

  try {
    const raw = await fs.readFile('/proc/mounts', 'utf8')
    const lines = raw.split('\n').filter((line) => line.trim() !== '')
    const seen = new Set<string>()
    const diskRows: HostSnapshot['disk'] = []

    for (const line of lines) {
      const parts = line.split(' ')
      const mount = parts[1]
      if (!mount) continue
      if (mount.startsWith('/proc') || mount.startsWith('/sys') || mount.startsWith('/dev')) continue
      if (seen.has(mount)) continue
      seen.add(mount)

      try {
        const stat = await fs.statfs(mount)
        const sizeBytes = stat.blocks * stat.bsize
        const freeBytes = stat.bavail * stat.bsize
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) continue

        const usedPct = toFraction((sizeBytes - freeBytes) / sizeBytes)
        diskRows.push({
          mount,
          usedPct,
          freeGB: freeBytes / BYTES_IN_GB,
          sizeGB: sizeBytes / BYTES_IN_GB,
        })
      } catch {
        // Mount point inacessível — ignora e continua para o próximo
      }
    }

    return diskRows
  } catch {
    return []
  }
}

/**
 * Calcula o throughput de rede em kilobits por segundo (kbps) via delta de contadores.
 *
 * @remarks
 * **Algoritmo:**
 * 1. Registra o timestamp atual e os bytes acumulados (`counters.rxBytes`, `counters.txBytes`).
 * 2. Na primeira chamada, inicializa `previousNetSample` e retorna zeros.
 * 3. Nas chamadas subsequentes, calcula:
 *    - `elapsedSec = (now − prev.timestampMs) / 1000`
 *    - `rxDelta = current.rxBytes − prev.rxBytes`
 *    - `txDelta = current.txBytes − prev.txBytes`
 *    - `rxKbps = (rxDelta × 8) / 1000 / elapsedSec`
 *    - `txKbps = (txDelta × 8) / 1000 / elapsedSec`
 * 4. Valores negativos (reset de contador, overflow) são truncados para `0`.
 * 5. Atualiza `previousNetSample`.
 *
 * **Conversão:** bytes/s → kbps = `bytes × 8 / 1000`.
 *
 * @param {NetCounters | null} counters - Contadores brutos de tráfego ou `null`
 *   quando a plataforma não suporta leitura de rede.
 *
 * @returns {{ rxKbps: number; txKbps: number }}
 *   Throughput em kbps. Retorna `{ rxKbps: 0, txKbps: 0 }` quando `counters` é `null`,
 *   na primeira chamada ou quando o intervalo de tempo é inválido.
 */
function computeNetworkThroughput(counters: NetCounters | null): {
  rxKbps: number
  txKbps: number
} {
  if (!counters) return { rxKbps: 0, txKbps: 0 }

  const now = Date.now()
  const current: NetSample = {
    timestampMs: now,
    rxBytes: counters.rxBytes,
    txBytes: counters.txBytes,
  }

  if (!previousNetSample) {
    previousNetSample = current
    return { rxKbps: 0, txKbps: 0 }
  }

  const elapsedSec = (current.timestampMs - previousNetSample.timestampMs) / 1000
  const rxDelta = current.rxBytes - previousNetSample.rxBytes
  const txDelta = current.txBytes - previousNetSample.txBytes
  previousNetSample = current

  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) {
    return { rxKbps: 0, txKbps: 0 }
  }

  /** Conversão: bytes/s → kbps = bytes × 8 / 1000 */
  const rxKbps = Math.max(0, (rxDelta * 8) / 1000 / elapsedSec)
  const txKbps = Math.max(0, (txDelta * 8) / 1000 / elapsedSec)

  return { rxKbps, txKbps }
}

/**
 * Caso de uso: Coletar e consolidar métricas em tempo real do host.
 *
 * @remarks
 * Agrega em uma única chamada assíncrona todas as métricas de CPU, memória,
 * disco, rede, processo Node.js e sistema, retornando um {@link HostSnapshot}
 * consolidado e pronto para serialização JSON.
 *
 * **Paralelismo interno:** As operações de I/O (`readNetCounters`, `readDiskSnapshot`)
 * e a medição de event loop (`measureEventLoopLagMs`) são iniciadas de forma
 * encadeada para maximizar o reaproveitamento dos contadores de CPU calculados
 * de forma síncrona antes das chamadas assíncronas.
 *
 * **Instâncias:** Pode ser instanciado como singleton ou por requisição.
 * O estado de histórico (variáveis `previous*`) é mantido em escopo de módulo,
 * portanto é compartilhado entre instâncias do mesmo processo.
 *
 * @example
 * ```typescript
 * const useCase = new GetHostMetricsUseCase()
 * const metrics = await useCase.execute()
 *
 * console.log(`CPU: ${(metrics.cpu.pct * 100).toFixed(1)}%`)
 * console.log(`RAM: ${(metrics.mem.usedPct * 100).toFixed(1)}%`)
 * console.log(`RSS: ${metrics.process.rssMB.toFixed(1)} MB`)
 * console.log(`Event Loop Lag: ${metrics.process.eventLoopLagMs.toFixed(2)} ms`)
 * ```
 */
export class GetHostMetricsUseCase {
  /**
   * Executa a coleta de todas as métricas do host e retorna um snapshot consolidado.
   *
   * @remarks
   * **Ordem de execução:**
   * 1. CPU do host (`computeCpuFractions`) — síncrono.
   * 2. CPU do processo (`computeProcessCpuFraction`) — síncrono.
   * 3. Lag do event loop (`measureEventLoopLagMs`) — assíncrono (~50 ms).
   * 4. Memória RAM — síncrono via `os.totalmem()` / `os.freemem()`.
   * 5. Contadores de rede (`readNetCounters`) — assíncrono (I/O de arquivo).
   * 6. Throughput de rede (`computeNetworkThroughput`) — síncrono (delta).
   * 7. Disco (`readDiskSnapshot`) — assíncrono (I/O de arquivo).
   * 8. Montagem do objeto {@link HostSnapshot} e retorno.
   *
   * @returns {Promise<HostSnapshot>}
   *   Snapshot completo das métricas do host no instante da chamada.
   *   Todos os campos numéricos são garantidamente finitos (sem `NaN` ou `Infinity`).
   */
  async execute(): Promise<HostSnapshot> {
    const cpuUsage = computeCpuFractions()
    const processCpuPct = computeProcessCpuFraction()
    const eventLoopLagMs = await measureEventLoopLagMs()

    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memUsedPct = totalMem > 0 ? toFraction(usedMem / totalMem) : 0

    const netCounters = await readNetCounters()
    const throughput = computeNetworkThroughput(netCounters)
    const disk = await readDiskSnapshot()

    return {
      timestamp: new Date().toISOString(),
      cpu: {
        pct: cpuUsage.total,
        perCore: cpuUsage.perCore,
        /** Load average disponível apenas em plataformas Unix (Linux/macOS). */
        load:
          process.platform !== 'win32'
            ? {
                one: os.loadavg()[0],
                five: os.loadavg()[1],
                fifteen: os.loadavg()[2],
              }
            : undefined,
      },
      mem: {
        usedPct: memUsedPct,
        totalGB: totalMem / BYTES_IN_GB,
        freeGB: freeMem / BYTES_IN_GB,
      },
      disk,
      net: {
        latencyMs: {},
        throughput,
        errors: netCounters
          ? { in: netCounters.rxErrors, out: netCounters.txErrors }
          : undefined,
      },
      process: {
        cpuPct: processCpuPct,
        rssMB: process.memoryUsage().rss / BYTES_IN_MB,
        eventLoopLagMs,
      },
      system: {
        uptimeSec: os.uptime(),
        host: os.hostname(),
        platform: process.platform,
        arch: process.arch,
      },
    }
  }
}
