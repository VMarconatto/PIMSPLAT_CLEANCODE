/* eslint-disable prettier/prettier */

/**
 * @file AlertsSample.ts
 * @description
 * Entidade de domínio que representa um único alerta industrial persistido,
 * originado do pipeline OPC UA → RabbitMQ → Consumer → PostgreSQL.
 *
 * Define também os tipos auxiliares {@link AlertLevel} e {@link AlertsSampleProps}
 * utilizados na construção e tipagem da entidade.
 *
 * @module alerts/domain/models/AlertsSample
 */

/**
 * Nível de desvio de um alerta industrial, conforme convenção de alarmes de processo.
 *
 * @remarks
 * Segue a nomenclatura padrão de sistemas SCADA/DCS para classificação de alarmes:
 *
 * | Valor     | Significado                          | Severidade   |
 * |-----------|--------------------------------------|--------------|
 * | `'LL'`    | Low Low — desvio crítico abaixo do   | Alta         |
 * |           | limite mínimo de segurança           |              |
 * | `'L'`     | Low — desvio abaixo do limite de     | Média        |
 * |           | atenção (pré-alarme baixo)           |              |
 * | `'H'`     | High — desvio acima do limite de     | Média        |
 * |           | atenção (pré-alarme alto)            |              |
 * | `'HH'`    | High High — desvio crítico acima do  | Alta         |
 * |           | limite máximo de segurança           |              |
 * | `'UNKNOWN'`| Nível não identificado pelo sistema | Indeterminada|
 *
 * @example
 * ```typescript
 * const nivel: AlertLevel = 'HH'; // alarme crítico alto
 * ```
 */
export type AlertLevel = 'LL' | 'L' | 'H' | 'HH' | 'UNKNOWN'

/**
 * Propriedades necessárias para construir uma instância de {@link AlertsSample}.
 *
 * @remarks
 * Utilizado exclusivamente pelo construtor de {@link AlertsSample}.
 * Normalmente populado a partir do registro retornado pelo banco de dados
 * ou do payload recebido do consumer RabbitMQ após persistência.
 *
 * @property {string}     id          - UUID do alerta gerado pelo banco de dados.
 * @property {string}     clientId    - Identificador único do cliente OPC UA que originou o alerta.
 * @property {string}     site        - Nome do site/planta onde o alerta foi emitido.
 * @property {Date}       timestamp   - Data/hora exata em que o alerta foi gerado (UTC).
 * @property {string}     tagName     - Nome da tag OPC UA que disparou o alerta (ex.: `'TEMP_REACTOR_01'`).
 * @property {number}     value       - Valor lido da tag no momento do disparo.
 * @property {AlertLevel} desvio      - Nível do desvio detectado (`'LL'` | `'L'` | `'H'` | `'HH'` | `'UNKNOWN'`).
 * @property {number}     alertsCount - Contador acumulado de disparos de alerta para esta tag.
 * @property {string}     unidade     - Unidade de engenharia do valor (ex.: `'°C'`, `'bar'`, `'m³/h'`).
 * @property {string[]}   recipients  - Lista de destinatários notificados (e-mails ou identificadores).
 * @property {Date}       [createdAt] - Data/hora de inserção no banco de dados. Opcional (gerado pelo banco).
 */
export type AlertsSampleProps = {
  id: string
  clientId: string
  site: string
  timestamp: Date
  tagName: string
  value: number
  desvio: AlertLevel
  alertsCount: number
  unidade: string
  recipients: string[]
  createdAt?: Date
}

/**
 * Entidade de domínio que representa um alerta industrial persistido.
 *
 * @remarks
 * Modela um único registro de alerta gerado pelo pipeline industrial:
 * **OPC UA → RabbitMQ → Consumer → PostgreSQL**.
 *
 * Todas as propriedades são imutáveis (`readonly`) após a construção,
 * refletindo o caráter de registro histórico do alerta — uma vez persistido,
 * não deve ser modificado.
 *
 * O método {@link toLegacyPayload} fornece compatibilidade retroativa com
 * o formato de payload já consumido pelo frontend antes da versão atual da API.
 *
 * @example
 * ```typescript
 * const alerta = new AlertsSample({
 *   id: 'c3d2a1b0-...',
 *   clientId: 'plant-A',
 *   site: 'Unidade-SP',
 *   timestamp: new Date('2025-01-15T10:30:00.000Z'),
 *   tagName: 'TEMP_REACTOR_01',
 *   value: 210.5,
 *   desvio: 'HH',
 *   alertsCount: 3,
 *   unidade: '°C',
 *   recipients: ['ops@company.com', 'supervisor@company.com'],
 * });
 *
 * console.log(alerta.desvio);   // 'HH'
 * console.log(alerta.value);    // 210.5
 *
 * const payload = alerta.toLegacyPayload();
 * // { timestamp: '2025-01-15T10:30:00.000Z', alertData: { TEMP_REACTOR_01: 210.5, ... }, ... }
 * ```
 */
export class AlertsSample {
  /** UUID único do alerta, gerado pelo banco de dados na inserção. */
  public readonly id: string

  /** Identificador do cliente OPC UA que originou o alerta. */
  public readonly clientId: string

  /** Nome do site/planta industrial de onde o alerta foi emitido. */
  public readonly site: string

  /** Data/hora exata (UTC) em que o alerta foi gerado pelo sistema OPC UA. */
  public readonly timestamp: Date

  /** Nome da tag OPC UA monitorada que ultrapassou o limite configurado. */
  public readonly tagName: string

  /** Valor numérico lido da tag no momento do disparo do alerta. */
  public readonly value: number

  /** Nível de desvio classificado pelo sistema de alarmes (`'LL'` | `'L'` | `'H'` | `'HH'` | `'UNKNOWN'`). */
  public readonly desvio: AlertLevel

  /** Contador acumulado de disparos de alerta para esta tag desde o último reset. */
  public readonly alertsCount: number

  /** Unidade de engenharia do valor medido (ex.: `'°C'`, `'bar'`, `'%'`, `'m³/h'`). */
  public readonly unidade: string

  /** Lista de destinatários (e-mails ou identificadores) que foram notificados sobre este alerta. */
  public readonly recipients: string[]

  /**
   * Data/hora em que o registro foi inserido no banco de dados (UTC).
   * Opcional — preenchido automaticamente pelo banco; ausente em instâncias criadas em memória.
   */
  public readonly createdAt?: Date

  /**
   * Cria uma nova instância imutável de {@link AlertsSample}.
   *
   * @param {AlertsSampleProps} props - Conjunto completo de propriedades do alerta.
   *   Normalmente proveniente do mapeamento do registro no banco de dados ou
   *   do payload já validado pelo caso de uso {@link ProcessAlertsUseCase}.
   */
  constructor(props: AlertsSampleProps) {
    this.id = props.id
    this.clientId = props.clientId
    this.site = props.site
    this.timestamp = props.timestamp
    this.tagName = props.tagName
    this.value = props.value
    this.desvio = props.desvio
    this.alertsCount = props.alertsCount
    this.unidade = props.unidade
    this.recipients = props.recipients
    this.createdAt = props.createdAt
  }

  /**
   * Serializa o alerta para o formato legado consumido pelo frontend.
   *
   * @remarks
   * Mantém retrocompatibilidade com contratos de API anteriores à versão atual.
   * O campo `alertData` agrupa os dados da tag, nível de desvio, contador de alertas
   * e unidade em um único objeto indexado pelo nome da tag, conforme esperado
   * pelo consumidor legado.
   *
   * **Estrutura do `alertData`:**
   * ```json
   * {
   *   "[tagName]": <value>,
   *   "AlertsCount": <alertsCount>,
   *   "Desvio": "<desvio>",
   *   "Unidade": "<unidade>"
   * }
   * ```
   *
   * @returns {{ timestamp: string, alertData: Record<string, unknown>, recipients: string[], clientId: string, site: string }}
   *   Objeto com:
   *   - `timestamp` — data/hora do alerta no formato ISO 8601 (`"2025-01-15T10:30:00.000Z"`).
   *   - `alertData` — mapa com os dados da tag e metadados do alerta.
   *   - `recipients` — cópia rasa da lista de destinatários notificados.
   *   - `clientId` — identificador do cliente OPC UA.
   *   - `site` — nome do site/planta de origem.
   *
   * @example
   * ```typescript
   * const payload = alerta.toLegacyPayload();
   *
   * // payload.timestamp   → "2025-01-15T10:30:00.000Z"
   * // payload.alertData   → { TEMP_REACTOR_01: 210.5, AlertsCount: 3, Desvio: 'HH', Unidade: '°C' }
   * // payload.recipients  → ['ops@company.com']
   * // payload.clientId    → 'plant-A'
   * // payload.site        → 'Unidade-SP'
   * ```
   */
  toLegacyPayload(): {
    timestamp: string
    alertData: Record<string, unknown>
    recipients: string[]
    clientId: string
    site: string
  } {
    return {
      timestamp: this.timestamp.toISOString(),
      alertData: {
        [this.tagName]: this.value,
        AlertsCount: this.alertsCount,
        Desvio: this.desvio,
        Unidade: this.unidade,
      },
      recipients: [...this.recipients],
      clientId: this.clientId,
      site: this.site,
    }
  }
}
