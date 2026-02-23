/* eslint-disable prettier/prettier */

/**
 * @file index.ts
 * @description
 * Configuração do contêiner de injeção de dependência (IoC) do módulo **Alerts**,
 * utilizando o `tsyringe` como container DI.
 *
 * @remarks
 * **Responsabilidades:**
 * - Registra o `DataSource` TypeORM como instância singleton compartilhada.
 * - Registra o `AlertsTypeormRepository` como singleton, satisfazendo o contrato
 *   `AlertsRepositoryInterface` exigido pelos casos de uso.
 * - Registra cada caso de uso como factory (transiente), injetando o repositório
 *   resolvido pelo container em cada instanciação.
 *
 * **Convenção de tokens:**
 * Os tokens de string usados em `container.register` / `container.resolve`
 * correspondem exatamente aos nomes das classes, facilitando rastreabilidade:
 *
 * | Token                    | Implementação                  | Ciclo de vida |
 * |--------------------------|-------------------------------|---------------|
 * | `'DataSource'`           | `dataSource` (TypeORM)        | Instância     |
 * | `'AlertsRepository'`     | `AlertsTypeormRepository`     | Singleton     |
 * | `'ProcessAlertsUseCase'` | `ProcessAlertsUseCase`        | Factory       |
 * | `'GetAlertsSentUseCase'` | `GetAlertsSentUseCase`        | Factory       |
 * | `'GetAlertsSummaryUseCase'` | `GetAlertsSummaryUseCase`  | Factory       |
 *
 * **Importação:** Este arquivo deve ser importado uma única vez durante o bootstrap
 * da aplicação, antes de qualquer resolução de dependências do módulo Alerts.
 *
 * @module alerts/infrastructure/container
 */

import { container } from 'tsyringe'
import { dataSource } from '../../../common/infrastructure/typeorm/index.js'
import { AlertsTypeormRepository } from '../typeorm/repositories/alerts-typeorm.repository.js'
import { ProcessAlertsUseCase } from '../../app/usecases/processAlerts.usecase.js'
import { GetAlertsSentUseCase } from '../../app/usecases/get-alerts-sent.usecase.js'
import { GetAlertsSummaryUseCase } from '../../app/usecases/get-alerts-summary.usecase.js'

/**
 * Registra o `DataSource` TypeORM como instância singleton no container.
 *
 * @remarks
 * Utiliza `registerInstance` para compartilhar a mesma conexão com o banco
 * de dados em todo o módulo, evitando conexões duplicadas.
 */
container.registerInstance('DataSource', dataSource)

/**
 * Registra o repositório de alertas como singleton.
 *
 * @remarks
 * `AlertsTypeormRepository` implementa `AlertsRepositoryInterface` e é
 * injetado nos casos de uso via token `'AlertsRepository'`.
 * Registrado como singleton para reutilizar a mesma instância e o flag
 * interno `schemaEnsured` (evita recriar índices a cada request).
 */
container.registerSingleton('AlertsRepository', AlertsTypeormRepository)

/**
 * Registra o caso de uso `ProcessAlertsUseCase` como factory transiente.
 *
 * @remarks
 * Cria uma nova instância a cada resolução, injetando o `AlertsRepository`
 * singleton como dependência. Invocado pelo consumer RabbitMQ ao processar
 * mensagens de alerta.
 */
container.register('ProcessAlertsUseCase', {
  useFactory: (c) => new ProcessAlertsUseCase(c.resolve('AlertsRepository')),
})

/**
 * Registra o caso de uso `GetAlertsSentUseCase` como factory transiente.
 *
 * @remarks
 * Cria uma nova instância a cada resolução, injetando o `AlertsRepository`.
 * Invocado pelo controller HTTP `GET /:clientId/alerts-sent`.
 */
container.register('GetAlertsSentUseCase', {
  useFactory: (c) => new GetAlertsSentUseCase(c.resolve('AlertsRepository')),
})

/**
 * Registra o caso de uso `GetAlertsSummaryUseCase` como factory transiente.
 *
 * @remarks
 * Cria uma nova instância a cada resolução, injetando o `AlertsRepository`.
 * Invocado pelo controller HTTP `GET /:clientId/alerts-summary`.
 */
container.register('GetAlertsSummaryUseCase', {
  useFactory: (c) => new GetAlertsSummaryUseCase(c.resolve('AlertsRepository')),
})
