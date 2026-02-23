/**
 * @file rate.ts
 * @description
 * Utilitário de cálculo de taxa de variação instantânea (Δvalor / Δtempo)
 * para métricas monitoradas via OPC UA.
 *
 * Mantém em memória o último valor e timestamp observados por chave,
 * permitindo calcular a derivada por segundo a cada nova medição recebida.
 * Tipicamente utilizado para expressar grandezas como vazão, velocidade
 * ou frequência de eventos derivadas de contadores ou sinais contínuos.
 *
 * @module alerts/infrastructure/rateLimit/rate
 */

/**
 * Armazena o último valor medido e o timestamp (epoch ms) por chave monitorada.
 *
 * @remarks
 * A chave é um identificador livre definido pelo chamador
 * (ex.: `'Client01_flow'`, `'Client02_PRESS_OUT'`).
 * A estrutura é limpa apenas quando a chave é substituída por uma nova medição;
 * chaves inativas permanecem em memória indefinidamente.
 */
const last = new Map<string, { v: number; t: number }>()

/**
 * Calcula a taxa de variação por segundo de uma métrica identificada por `key`.
 *
 * @remarks
 * **Algoritmo:**
 * - Na primeira chamada para uma `key`, registra o valor e retorna `0`
 *   (sem medição anterior, a taxa é indeterminada).
 * - Nas chamadas subsequentes, calcula `Δv / Δt` onde:
 *   - `Δv = current − prev.v` (variação do valor).
 *   - `Δt = (now − prev.t) / 1000` (intervalo em segundos).
 * - Retorna `0` quando:
 *   - `Δt ≤ 0` (chamadas com resolução de tempo insuficiente).
 *   - `Δv < 0` (regressão de valor, ex.: reset de contador), evitando taxa negativa.
 *
 * **Thread-safety:** Não é thread-safe. Em Node.js (single-threaded), isso
 * geralmente não é problema, mas leituras/escritas concorrentes em cenários
 * assíncronos podem produzir resultados inconsistentes.
 *
 * @param {string} key     - Identificador único da série monitorada
 *   (ex.: `'Client01_PT02'`, `'plant-A_FLOW_01'`).
 * @param {number} current - Valor atual lido da tag OPC UA.
 *
 * @returns {number}
 *   Taxa de variação em unidades por segundo (`Δv / Δt`).
 *   Retorna `0` na primeira medição ou quando o valor regredir.
 *
 * @example
 * ```typescript
 * // Primeira chamada — sem histórico, retorna 0
 * ratePerSec('Client01_PT02', 100); // → 0
 *
 * // Após 500 ms com valor aumentado em 10
 * ratePerSec('Client01_PT02', 110); // → ≈ 20 unidades/s  (10 / 0.5)
 *
 * // Regressão de valor — retorna 0
 * ratePerSec('Client01_PT02', 50);  // → 0
 * ```
 */
export function ratePerSec(key: string, current: number): number {
  const now = Date.now()
  const prev = last.get(key)
  last.set(key, { v: current, t: now })

  if (!prev) return 0

  /** Δt em segundos — intervalo entre a medição atual e a anterior. */
  const dt = (now - prev.t) / 1000
  /** Δv — variação do valor entre as duas medições. */
  const dv = current - prev.v

  // Retorna 0 se o intervalo de tempo for inválido ou se o valor regredir
  return dt > 0 && dv >= 0 ? dv / dt : 0
}
