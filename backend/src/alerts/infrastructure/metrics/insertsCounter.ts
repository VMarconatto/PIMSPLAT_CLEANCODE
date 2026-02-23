/**
 * @file insertsCounter.ts
 * @description
 * Contador in-memory de inserts de alertas por cliente, baseado em **time buckets**.
 *
 * @remarks
 * **Algoritmo de sliding-window com buckets:**
 * - O tempo é dividido em buckets de {@link BUCKET_MS} ms (5 s).
 * - Uma janela deslizante de {@link WINDOW_MS} ms (60 s) contém exatamente
 *   {@link BUCKETS_IN_WINDOW} buckets (12).
 * - Cada insert incrementa o contador do bucket atual (`floor(Date.now() / BUCKET_MS)`).
 * - Buckets mais antigos que a janela são descartados (`pruneOldBuckets`) para
 *   evitar crescimento ilimitado de memória.
 * - Custo por operação: **O(1)** para `recordInserts`; **O(buckets)** para leitura.
 *
 * **Extensibilidade:** A API pública pode ser adaptada para Redis sem alterar
 * contratos; basta substituir o `Map` interno por chamadas assíncronas ao Redis.
 *
 * @module alerts/infrastructure/metrics/insertsCounter
 */

/** Duração de cada bucket de tempo em milissegundos (5 segundos). */
const BUCKET_MS = 5_000;

/** Duração total da janela deslizante em milissegundos (60 segundos = 1 minuto). */
const WINDOW_MS = 60_000;

/** Número de buckets na janela deslizante (`WINDOW_MS / BUCKET_MS = 12`). */
const BUCKETS_IN_WINDOW = WINDOW_MS / BUCKET_MS;

/**
 * Estrutura interna de contador para um único cliente.
 *
 * @property {Map<number, number>} buckets
 *   Mapa de `índice de bucket → quantidade de inserts` naquele intervalo de 5 s.
 *   O índice é calculado como `floor(Date.now() / BUCKET_MS)`.
 */
type Counter = {
  buckets: Map<number, number>;
};

/**
 * Armazena os contadores de inserts indexados por `clientId`.
 *
 * @remarks
 * Mantido em memória durante todo o ciclo de vida do processo.
 * Clientes inativos permanecem no mapa até que seus buckets sejam removidos
 * naturalmente pela janela deslizante.
 */
const store = new Map<string, Counter>();

/**
 * Calcula o índice do bucket de tempo correspondente ao instante atual.
 *
 * @remarks
 * O índice é um inteiro monotonicamente crescente que avança a cada `BUCKET_MS`.
 * Buckets com índice menor que `(currentIdx - BUCKETS_IN_WINDOW + 1)` estão
 * fora da janela e devem ser descartados.
 *
 * @returns {number} Índice do bucket atual (`floor(Date.now() / BUCKET_MS)`).
 */
function nowBucketIdx(): number {
  return Math.floor(Date.now() / BUCKET_MS);
}

/**
 * Retorna o contador existente para um `clientId` ou cria um novo se não existir.
 *
 * @param {string} clientId - Identificador único do cliente OPC UA.
 * @returns {Counter} Contador com mapa de buckets do cliente.
 */
function getOrCreate(clientId: string): Counter {
  let c = store.get(clientId);
  if (!c) {
    c = { buckets: new Map() };
    store.set(clientId, c);
  }
  return c;
}

/**
 * Remove buckets cujo índice está fora da janela deslizante atual.
 *
 * @remarks
 * Um bucket de índice `k` é considerado expirado quando
 * `k < (currentIdx - BUCKETS_IN_WINDOW + 1)`.
 * Esta função deve ser chamada antes de qualquer leitura acumulada para
 * garantir que apenas dados recentes (dentro de 60 s) sejam considerados.
 *
 * @param {Counter} counter    - Contador do cliente a ser limpo.
 * @param {number}  currentIdx - Índice do bucket atual retornado por {@link nowBucketIdx}.
 * @returns {void}
 */
function pruneOldBuckets(counter: Counter, currentIdx: number): void {
  const minIdx = currentIdx - BUCKETS_IN_WINDOW + 1;
  for (const k of counter.buckets.keys()) {
    if (k < minIdx) counter.buckets.delete(k);
  }
}

/**
 * Registra `n` inserts realizados para um determinado cliente no bucket atual.
 *
 * @remarks
 * Chamadas com `clientId` vazio ou `n ≤ 0` são ignoradas silenciosamente.
 * Após o incremento, os buckets expirados são descartados automaticamente.
 *
 * @param {string} clientId - Identificador único do cliente OPC UA.
 * @param {number} [n=1]    - Quantidade de inserts a registrar (deve ser > 0).
 * @returns {void}
 *
 * @example
 * ```typescript
 * recordInserts('plant-A')       // registra 1 insert
 * recordInserts('plant-A', 5)    // registra mais 5 inserts no mesmo bucket
 * recordInserts('plant-B', 3)    // registra 3 inserts para outro cliente
 * ```
 */
export function recordInserts(clientId: string, n = 1): void {
  if (!clientId || n <= 0) return;
  const counter = getOrCreate(clientId);
  const idx = nowBucketIdx();
  const prev = counter.buckets.get(idx) ?? 0;
  counter.buckets.set(idx, prev + n);
  pruneOldBuckets(counter, idx);
}

/**
 * Retorna a taxa de inserts por minuto na janela dos últimos 60 segundos.
 *
 * @remarks
 * Como a janela total é exatamente 60 s, a soma de todos os buckets equivale
 * diretamente à quantidade de inserts por minuto, sem necessidade de escalonamento.
 *
 * Retorna `0` quando não há dados registrados para o `clientId`.
 *
 * @param {string} clientId - Identificador único do cliente OPC UA.
 * @returns {number} Número estimado de inserts por minuto na última janela de 60 s.
 *
 * @example
 * ```typescript
 * const rate = getInsertsPerMin('plant-A')
 * console.log(`${rate} inserts/min`)
 * ```
 */
export function getInsertsPerMin(clientId: string): number {
  const counter = store.get(clientId);
  if (!counter) return 0;
  const idx = nowBucketIdx();
  pruneOldBuckets(counter, idx);

  let sum = 0;
  for (let i = idx - BUCKETS_IN_WINDOW + 1; i <= idx; i++) {
    sum += counter.buckets.get(i) ?? 0;
  }
  // Janela total = 60 s → soma direta = inserts por minuto
  return sum;
}

/**
 * Retorna a série temporal de inserts dos últimos `points` buckets.
 *
 * @remarks
 * Cada ponto da série representa a contagem de inserts em um intervalo de
 * `BUCKET_MS` ms (5 s), convertida para taxa equivalente por minuto
 * multiplicando por `60 000 / BUCKET_MS` (fator 12).
 *
 * O array retornado tem exatamente `points` elementos, com `0` para buckets
 * sem dados (sem atividade naquele intervalo de 5 s).
 *
 * @param {string} clientId                    - Identificador único do cliente OPC UA.
 * @param {number} [points=BUCKETS_IN_WINDOW]  - Quantidade de pontos na série
 *   (padrão: 12 buckets = 60 s de histórico).
 * @returns {number[]}
 *   Vetor de `points` números, cada um representando a taxa de inserts/min
 *   estimada para aquele bucket de 5 s. Ordem cronológica ascendente
 *   (índice 0 = bucket mais antigo, último índice = bucket atual).
 *
 * @example
 * ```typescript
 * const serie = getInsertsSeries('plant-A')
 * // → [0, 0, 12, 24, 12, 0, 0, 0, 60, 48, 12, 0]
 * // Cada número = inserts/min estimados naquele bucket de 5 s
 * ```
 */
export function getInsertsSeries(
  clientId: string,
  points = BUCKETS_IN_WINDOW
): number[] {
  const counter = store.get(clientId);
  if (!counter) return Array(points).fill(0);
  const idx = nowBucketIdx();
  pruneOldBuckets(counter, idx);

  const series: number[] = [];
  for (let i = idx - points + 1; i <= idx; i++) {
    const bucketCount = counter.buckets.get(i) ?? 0;
    /** Escalonamento: cada bucket é 5 s → por minuto = count × (60 000 / 5 000) = count × 12 */
    series.push(bucketCount * (60_000 / BUCKET_MS));
  }
  return series;
}
