/* eslint-disable prettier/prettier */

/**
 * @file TelemetryRepository.ts
 * @description
 * Interface do repositório de Telemetria no **domínio** do módulo Telemetry.
 *
 * Contexto (Clean Architecture):
 * - Este arquivo define uma **porta de saída (outbound port)** do domínio.
 * - Ele descreve **o que o domínio precisa** para persistir e consultar amostras
 *   de telemetria, mas **não como isso é feito**.
 * - Estende a ITelemetryRepository genérica do módulo common,
 *   tipando com os models concretos deste módulo.
 *
 * Importante:
 * - Nenhuma implementação concreta (TypeORM, InMemory, etc.) deve aparecer aqui.
 * - A infraestrutura implementa esta interface.
 * - A camada application depende APENAS desta abstração.
 */

import { ITelemetryRepository } from '../../../common/domain/repositories/repository.interface.js'
import { TelemetrySample } from '../models/TelemetrySample.js'
import { TelemetryMessage } from '../../../messaging/types.js'

/**
 * Contrato do repositório de telemetria do módulo Telemetry.
 *
 * Responsabilidades:
 * - Persistir amostras de telemetria (vindas do consumer RabbitMQ)
 * - Consultar dados históricos por client, período e tags
 * - Gerenciar tabelas dinâmicas por OpcuaClient
 *
 * Herda de ITelemetryRepository com:
 * - Model = TelemetrySample (entidade de domínio)
 * - CreateProps = TelemetryMessage (payload recebido do RabbitMQ)
 *
 * A implementação concreta (TypeORM/Postgres) é responsável por:
 * - Converter TelemetryMessage → row do banco (insert)
 * - Converter row do banco → TelemetrySample (query)
 */
export interface TelemetryRepositoryInterface
  extends ITelemetryRepository<TelemetrySample, TelemetryMessage> {

  /**
   * Verifica se uma amostra com o dado msgId já existe (idempotência).
   * Usado pelo consumer para evitar duplicatas em caso de redelivery.
   *
   * @param clientName - Nome do OpcuaClient (identifica a tabela).
   * @param msgId - Identificador único da mensagem (UUID).
   * @returns true se já existe, false caso contrário.
   */
  existsByMsgId(clientName: string, msgId: string): Promise<boolean>
}
