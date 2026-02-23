/* eslint-disable prettier/prettier */

/**
 * @file processAlerts.usecase.ts
 * @description
 * Caso de uso responsável por processar e persistir alertas industriais recebidos
 * via RabbitMQ (originados do pipeline OPC UA → RabbitMQ → Consumer).
 *
 * Aplica validação de campos obrigatórios e deduplicação temporal (janela de
 * supressão configurável), evitando duplicatas de alertas para o mesmo par
 * `(clientId, tagName, desvio)` dentro de um intervalo de tempo definido.
 *
 * @module alerts/app/usecases/processAlerts
 */

import { BadRequestError } from '../../../common/domain/errors/bad-request-error.js'
import { AppError } from '../../../common/domain/errors/app-error.js'
import {
  AlertsRepositoryInterface,
  CreateAlertInput,
} from '../../domain/repositories/AlertsRepository.js'
import { AlertsSample } from '../../domain/models/AlertsSample.js'

/**
 * Dados de entrada para o processamento de um alerta industrial.
 *
 * @remarks
 * Estende {@link CreateAlertInput} acrescentando o campo opcional
 * `dedupWindowMs`, que permite sobrescrever a janela de deduplicação
 * definida pela variável de ambiente `ALERT_DEDUP_MS` (padrão: **300 000 ms = 5 min**).
 *
 * @property {string | Date} timestamp
 *   Data/hora em que o alerta foi gerado.
 *   Aceita string ISO 8601 (`"2025-01-15T10:30:00.000Z"`) ou objeto `Date`.
 *
 * @property {string} clientId
 *   Identificador único do cliente OPC UA que originou o alerta.
 *
 * @property {string} [site]
 *   Nome do site/planta de onde o alerta foi emitido. Opcional.
 *
 * @property {string} tagName
 *   Nome da tag OPC UA que disparou o alerta (ex.: `'TEMP_REACTOR_01'`).
 *
 * @property {number} value
 *   Valor lido da tag no momento do disparo.
 *
 * @property {AlertLevel} desvio
 *   Nível do desvio detectado. Valores possíveis: `'LL'` | `'L'` | `'H'` | `'HH'` | `'UNKNOWN'`.
 *
 * @property {number} alertsCount
 *   Contador acumulado de alertas disparados para esta tag desde o último reset.
 *
 * @property {string} unidade
 *   Unidade de engenharia do valor medido (ex.: `'°C'`, `'bar'`, `'m³/h'`).
 *
 * @property {string[]} recipients
 *   Lista de destinatários (e-mails ou identificadores) para notificação do alerta.
 *
 * @property {number} [dedupWindowMs]
 *   Janela de deduplicação em milissegundos.
 *   Prioridade: valor do payload > `ALERT_DEDUP_MS` (env) > padrão **300 000 ms (5 min)**.
 */
export type ProcessAlertInput = CreateAlertInput & {
  dedupWindowMs?: number
}

/**
 * Resultado retornado após o processamento de um alerta.
 *
 * @property {boolean} saved
 *   `true` se o alerta foi efetivamente persistido no banco de dados;
 *   `false` se foi suprimido pela política de deduplicação.
 *
 * @property {AlertsSample | null} alert
 *   Entidade {@link AlertsSample} salva quando `saved` é `true`,
 *   ou `null` quando o alerta foi suprimido por deduplicação.
 */
export type ProcessAlertOutput = {
  saved: boolean
  alert: AlertsSample | null
}

/**
 * Caso de uso: Processar e persistir um alerta industrial.
 *
 * @remarks
 * **Responsabilidades:**
 * 1. Validar os campos obrigatórios do payload recebido (via {@link validate}).
 * 2. Determinar a janela de deduplicação (`dedupWindowMs`), priorizando o valor
 *    do próprio payload, depois a variável de ambiente `ALERT_DEDUP_MS` e,
 *    por último, o padrão de **5 minutos (300 000 ms)**.
 * 3. Delegar ao repositório a persistência com controle de deduplicação
 *    (método `insertIfNotRecent`).
 * 4. Mapear erros de infraestrutura desconhecidos em {@link AppError} com
 *    categoria `DATABASE` e `retryable: true`, permitindo retentativas seguras
 *    pelo consumidor RabbitMQ.
 *
 * **Deduplicação:** Impede que o mesmo alerta `(clientId, tagName, desvio)` seja
 * persistido mais de uma vez dentro da janela de tempo configurada, evitando
 * spam de notificações em condições de alarme persistente.
 *
 * **Integração:** Normalmente invocado pelo consumer RabbitMQ após o recebimento
 * de uma mensagem de alerta no exchange/queue dedicado.
 *
 * @example
 * ```typescript
 * const useCase = new ProcessAlertsUseCase(alertsRepository);
 *
 * const result = await useCase.execute({
 *   clientId: 'plant-A',
 *   tagName: 'TEMP_REACTOR_01',
 *   value: 210.5,
 *   desvio: 'HH',
 *   alertsCount: 3,
 *   unidade: '°C',
 *   recipients: ['ops@company.com'],
 *   timestamp: new Date(),
 *   dedupWindowMs: 60_000, // sobrescreve o padrão: janela de 1 minuto
 * });
 *
 * if (result.saved) {
 *   console.log('Alerta persistido:', result.alert?.id);
 * } else {
 *   console.log('Alerta suprimido por deduplicação.');
 * }
 * ```
 */
export class ProcessAlertsUseCase {
  /**
   * Cria uma nova instância do caso de uso.
   *
   * @param {AlertsRepositoryInterface} alertsRepository - Repositório de alertas
   *   usado para persistência e verificação de deduplicação temporal.
   */
  constructor(
    private readonly alertsRepository: AlertsRepositoryInterface,
  ) {}

  /**
   * Executa o processamento do alerta: valida, deduplica e persiste.
   *
   * @param {ProcessAlertInput} input - Payload completo do alerta a ser processado.
   *
   * @returns {Promise<ProcessAlertOutput>}
   *   Objeto indicando se o alerta foi salvo (`saved`) e,
   *   quando salvo, a entidade {@link AlertsSample} persistida (`alert`).
   *
   * @throws {BadRequestError}
   *   Quando campos obrigatórios estão ausentes ou inválidos
   *   (ex.: `clientId` vazio, `timestamp` com formato inválido, `value` não numérico).
   *
   * @throws {AppError}
   *   Quando ocorre falha de infraestrutura ao acessar o banco de dados.
   *   `retryable: true` indica que o consumidor pode retentar a operação com segurança.
   */
  async execute(input: ProcessAlertInput): Promise<ProcessAlertOutput> {
    this.validate(input)

    /**
     * Janela de deduplicação efetiva em milissegundos.
     * Ordem de prioridade: payload → env `ALERT_DEDUP_MS` → padrão 5 min.
     */
    const dedupWindowMs = input.dedupWindowMs ?? Number(process.env.ALERT_DEDUP_MS ?? 5 * 60 * 1000)

    try {
      const savedAlert = await this.alertsRepository.insertIfNotRecent(input, dedupWindowMs)
      return {
        saved: savedAlert !== null,
        alert: savedAlert,
      }
    } catch (err) {
      if (err instanceof AppError) {
        throw err
      }

      throw new AppError(
        `Failed to process alert for client "${input.clientId}": ${err instanceof Error ? err.message : String(err)}`,
        {
          category: 'DATABASE',
          isOperational: true,
          retryable: true,
          cause: err,
        },
      )
    }
  }

  /**
   * Valida os campos obrigatórios do payload de alerta.
   *
   * @remarks
   * Os campos verificados são:
   * - `clientId` — string não vazia.
   * - `tagName` — string não vazia.
   * - `desvio` — valor de {@link AlertLevel} não vazio.
   * - `recipients` — deve ser um array (podendo estar vazio).
   * - `timestamp` — conversível em `Date` válida (ISO 8601 ou objeto `Date`).
   * - `value` — número finito (rejeita `NaN`, `Infinity`, `undefined`).
   * - `alertsCount` — número finito (rejeita `NaN`, `Infinity`, `undefined`).
   *
   * Todos os erros são acumulados e lançados juntos em um único
   * {@link BadRequestError}, listando todos os campos ausentes/inválidos.
   *
   * @param {ProcessAlertInput} input - Payload a ser validado.
   * @returns {void}
   *
   * @throws {BadRequestError}
   *   Quando um ou mais campos obrigatórios estão ausentes ou possuem valor inválido.
   *   A mensagem inclui a lista completa de campos problemáticos para facilitar o diagnóstico.
   */
  private validate(input: ProcessAlertInput): void {
    /** Acumula os nomes dos campos ausentes ou inválidos. */
    const missing: string[] = []

    if (!input.clientId) missing.push('clientId')
    if (!input.tagName) missing.push('tagName')
    if (!input.desvio) missing.push('desvio')
    if (!Array.isArray(input.recipients)) missing.push('recipients')

    const timestamp =
      input.timestamp instanceof Date ? input.timestamp : new Date(input.timestamp)
    if (Number.isNaN(timestamp.getTime())) {
      missing.push('timestamp(valid ISO date)')
    }

    if (!Number.isFinite(input.value)) {
      missing.push('value(number)')
    }

    if (!Number.isFinite(input.alertsCount)) {
      missing.push('alertsCount(number)')
    }

    if (missing.length > 0) {
      throw new BadRequestError(
        `Invalid alert payload: missing/invalid fields [${missing.join(', ')}]`,
        {
          received: input,
        },
      )
    }
  }
}
