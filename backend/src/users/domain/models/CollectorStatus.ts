/* eslint-disable prettier/prettier */

/**
 * @file CollectorStatus.ts
 * @description
 * Entidade de domínio que representa o estado operacional de um coletor OPC UA.
 *
 * Contexto:
 * - Cada OpcuaClient (coletor) possui um estado em tempo real: conectado, desconectado,
 *   leituras realizadas, latência, erros, etc.
 * - Este model encapsula esse estado e fornece métodos para avaliação da saúde do coletor.
 *
 * Em Clean Architecture:
 * - Pertence à camada **Domain** — não depende de infra (OPC UA SDK, RabbitMQ, etc.).
 * - O use case GetStatusUseCase monta este model a partir dos dados brutos do ClientManager.
 * - A camada HTTP converte para JSON de resposta.
 *
 * Diferença entre CollectorStatus e TelemetrySample:
 * - TelemetrySample = dado coletado (persistido no banco)
 * - CollectorStatus = estado do coletor (em memória, tempo real)
 */

export type CollectorHealth = 'healthy' | 'degraded' | 'disconnected' | 'error'

export type CollectorStatusProps = {
  clientId: string
  endpoint: string
  connected: boolean
  connecting: boolean
  lastConnectTimestamp?: string
  lastDisconnectTimestamp?: string
  lastReadTimestamp?: string
  lastLatencyMs?: number
  readCount: number
  reconnectCount: number
  activeNodeIdsCount: number
  lastError?: string
}

export class CollectorStatus {
  public readonly clientId: string
  public readonly endpoint: string
  public readonly connected: boolean
  public readonly connecting: boolean
  public readonly lastConnectTimestamp?: string
  public readonly lastDisconnectTimestamp?: string
  public readonly lastReadTimestamp?: string
  public readonly lastLatencyMs?: number
  public readonly readCount: number
  public readonly reconnectCount: number
  public readonly activeNodeIdsCount: number
  public readonly lastError?: string

  constructor(props: CollectorStatusProps) {
    this.clientId = props.clientId
    this.endpoint = props.endpoint
    this.connected = props.connected
    this.connecting = props.connecting
    this.lastConnectTimestamp = props.lastConnectTimestamp
    this.lastDisconnectTimestamp = props.lastDisconnectTimestamp
    this.lastReadTimestamp = props.lastReadTimestamp
    this.lastLatencyMs = props.lastLatencyMs
    this.readCount = props.readCount
    this.reconnectCount = props.reconnectCount
    this.activeNodeIdsCount = props.activeNodeIdsCount
    this.lastError = props.lastError
  }

  /**
   * Avalia a saúde geral do coletor com base no estado atual.
   *
   * - healthy: conectado, sem erros, leituras recentes
   * - degraded: conectado mas com erros ou reconexões frequentes
   * - disconnected: não conectado (pode estar tentando reconectar)
   * - error: desconectado com erro registrado
   */
  getHealth(): CollectorHealth {
    if (!this.connected && !this.connecting) {
      return this.lastError ? 'error' : 'disconnected'
    }

    if (this.connecting) {
      return 'degraded'
    }

    // Conectado — verifica sinais de degradação
    if (this.lastError || this.reconnectCount > 3) {
      return 'degraded'
    }

    return 'healthy'
  }

  /**
   * Indica se o coletor está ativamente coletando dados.
   * Verdadeiro quando conectado e com nodeIds configurados para polling.
   */
  isCollecting(): boolean {
    return this.connected && this.activeNodeIdsCount > 0
  }

  /**
   * Retorna há quanto tempo (em ms) foi a última leitura.
   * Retorna null se nunca houve leitura.
   */
  getTimeSinceLastRead(): number | null {
    if (!this.lastReadTimestamp) return null
    return Date.now() - new Date(this.lastReadTimestamp).getTime()
  }

  /**
   * Converte para objeto plano (útil para serialização/resposta HTTP).
   */
  toJSON(): CollectorStatusProps & { health: CollectorHealth; isCollecting: boolean } {
    return {
      clientId: this.clientId,
      endpoint: this.endpoint,
      connected: this.connected,
      connecting: this.connecting,
      lastConnectTimestamp: this.lastConnectTimestamp,
      lastDisconnectTimestamp: this.lastDisconnectTimestamp,
      lastReadTimestamp: this.lastReadTimestamp,
      lastLatencyMs: this.lastLatencyMs,
      readCount: this.readCount,
      reconnectCount: this.reconnectCount,
      activeNodeIdsCount: this.activeNodeIdsCount,
      lastError: this.lastError,
      health: this.getHealth(),
      isCollecting: this.isCollecting(),
    }
  }
}
