/* eslint-disable prettier/prettier */

/**
 * @file repository.interface.ts
 * @description
 * Contratos base para repositórios de telemetria industrial.
 *
 * Este arquivo define:
 * - `SearchInput`: parâmetros para busca paginada de amostras de telemetria,
 *   incluindo filtro por clientName e intervalo temporal.
 * - `SearchOutput<T>`: formato padronizado de retorno de uma busca paginada.
 * - `ITelemetryRepository<Model, CreateProps>`: contrato genérico que repositórios
 *   concretos (TypeORM/Postgres, in-memory, etc.) devem implementar.
 *
 * Contexto:
 * - Dados coletados via OPC UA são publicados no RabbitMQ (Envelope<TelemetryMessage>).
 * - O consumer consome essas mensagens e persiste no PostgreSQL.
 * - Cada OpcuaClient possui sua própria tabela no Postgres, identificada pelo clientName.
 * - A consulta por dados de um client específico é feita pelo clientName.
 *
 * Em Clean Architecture, este contrato é usado pela camada de Application,
 * permitindo trocar a implementação (Infra) sem alterar os casos de uso.
 */

/**
 * @typedef SearchInput
 * @description
 * Parâmetros de entrada para busca de amostras de telemetria,
 * incluindo paginação, ordenação, filtro por clientName e intervalo temporal.
 *
 * @property clientName - Nome do OpcuaClient (identifica a tabela no Postgres).
 * @property startDate - (Opcional) Início do intervalo temporal (inclusivo).
 * @property endDate - (Opcional) Fim do intervalo temporal (inclusivo).
 * @property page - (Opcional) Página atual (1-based).
 * @property per_page - (Opcional) Quantidade de itens por página.
 * @property sort - (Opcional) Campo pelo qual ordenar (ex: "timestamp").
 * @property sort_dir - (Opcional) Direção de ordenação ("asc" | "desc").
 * @property tagFilter - (Opcional) Filtro por nome de tag específico dentro dos dados.
 */
export type SearchInput = {
  clientName: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  per_page?: number;
  sort?: string | null;
  sort_dir?: 'asc' | 'desc' | null;
  tagFilter?: string | null;
  siteFilter?: string | null;
};

/**
 * @typedef SearchOutput<T>
 * @description
 * Formato padronizado do retorno de uma busca paginada.
 *
 * @template T - Tipo do item retornado.
 * @property items - Lista de amostras na página atual.
 * @property per_page - Itens por página efetivamente usados.
 * @property total - Total de amostras encontradas (antes da paginação).
 * @property current_page - Página atual (1-based).
 * @property sort - Campo de ordenação aplicado (ou null).
 * @property sort_dir - Direção de ordenação aplicada (ou null).
 * @property clientName - Nome do client consultado.
 */
export type SearchOutput<T> = {
  items: T[];
  per_page: number;
  total: number;
  current_page: number;
  sort: string | null;
  sort_dir: string | null;
  clientName: string;
};

/**
 * @interface ITelemetryRepository
 * @description
 * Contrato genérico de repositório para persistência de dados de telemetria industrial.
 *
 * Projetado para o fluxo: OPC UA → RabbitMQ → Consumer → PostgreSQL.
 * Cada OpcuaClient (clientName) corresponde a uma tabela dedicada no Postgres.
 *
 * @template Model - Tipo da entidade/amostra de telemetria persistida.
 * @template CreateProps - Tipo do payload usado para criar uma amostra (ex: TelemetryMessage).
 */
export interface ITelemetryRepository<Model, CreateProps> {
  /**
   * Garante que a tabela do client existe no Postgres.
   * Deve ser chamado antes de inserir dados de um novo client.
   * Operação idempotente (CREATE TABLE IF NOT EXISTS).
   *
   * @param clientName - Nome do OpcuaClient (usado como identificador da tabela).
   */
  ensureTable(clientName: string): Promise<void>;

  /**
   * Insere uma única amostra de telemetria na tabela do client.
   *
   * @param clientName - Nome do OpcuaClient (identifica a tabela).
   * @param props - Dados da amostra a ser persistida.
   * @returns A amostra persistida com id e timestamp gerados pelo banco.
   */
  insert(clientName: string, props: CreateProps): Promise<Model>;

  /**
   * Insere múltiplas amostras de telemetria em lote (batch insert).
   * Otimizado para alto throughput de dados OPC UA.
   *
   * @param clientName - Nome do OpcuaClient (identifica a tabela).
   * @param props - Array de amostras a serem persistidas.
   * @returns Array de amostras persistidas.
   */
  insertBatch(clientName: string, props: CreateProps[]): Promise<Model[]>;

  /**
   * Busca uma amostra pelo seu identificador único (msgId/UUID).
   *
   * @param clientName - Nome do OpcuaClient (identifica a tabela).
   * @param id - Identificador único da amostra (msgId).
   * @returns A amostra encontrada.
   */
  findById(clientName: string, id: string): Promise<Model>;

  /**
   * Busca as amostras mais recentes de um client.
   *
   * @param clientName - Nome do OpcuaClient (identifica a tabela).
   * @param limit - Quantidade máxima de registros a retornar (default: 100).
   * @returns Array com as amostras mais recentes.
   */
  findLatest(clientName: string, limit?: number): Promise<Model[]>;

  /**
   * Busca amostras dentro de um intervalo temporal.
   *
   * @param clientName - Nome do OpcuaClient (identifica a tabela).
   * @param startDate - Início do intervalo (inclusivo).
   * @param endDate - Fim do intervalo (inclusivo).
   * @returns Array de amostras no intervalo.
   */
  findByTimeRange(
    clientName: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Model[]>;

  /**
   * Remove amostras anteriores a uma data (retenção de dados).
   * Útil para políticas de cleanup/retenção de dados históricos.
   *
   * @param clientName - Nome do OpcuaClient (identifica a tabela).
   * @param before - Data limite: amostras anteriores a esta data serão removidas.
   * @returns Quantidade de registros removidos.
   */
  deleteOlderThan(clientName: string, before: Date): Promise<number>;

  /**
   * Executa busca paginada com suporte a filtro temporal e por tag.
   *
   * @param props - Parâmetros de busca (clientName, datas, paginação, filtro de tag).
   * @returns Estrutura de saída padronizada com amostras e metadados de paginação.
   */
  search(props: SearchInput): Promise<SearchOutput<Model>>;
}

/**
 * @typedef AlertSummaryOutput
 * @description
 * Resultado agregado dos alertas de um cliente.
 */
export type AlertSummaryOutput = {
  clientId: string;
  total: number;
  byLevel: Record<string, number>;
  byTag: Record<string, number>;
  lastTimestamp: string | null;
};

/**
 * @interface ICrudRepository
 * @description
 * Contrato genérico de CRUD para entidades de configuração (ex: perfis de conexão OPC UA).
 *
 * Diferente do ITelemetryRepository (voltado para séries temporais com tabelas dinâmicas),
 * este contrato é adequado para entidades com tabela fixa e ciclo de vida CRUD clássico.
 *
 * @template Model - Tipo da entidade de domínio retornada.
 * @template CreateProps - Tipo do payload de criação.
 * @template UpdateProps - Tipo do payload de atualização (default: Partial<CreateProps>).
 */
export interface ICrudRepository<Model, CreateProps, UpdateProps = Partial<CreateProps>> {
  /**
   * Cria e persiste uma nova entidade.
   * @param props - Dados de criação.
   * @returns Entidade criada com id e timestamps gerados.
   */
  create(props: CreateProps): Promise<Model>;

  /**
   * Busca uma entidade pelo seu identificador único (UUID).
   * @param id - UUID da entidade.
   * @returns Entidade encontrada ou `null` quando não existe.
   */
  findById(id: string): Promise<Model | null>;

  /**
   * Retorna todas as entidades cadastradas, ordenadas de forma consistente.
   * @returns Array com todas as entidades.
   */
  findAll(): Promise<Model[]>;

  /**
   * Atualiza os campos informados de uma entidade existente.
   * @param id - UUID da entidade a atualizar.
   * @param props - Campos a modificar (parcial).
   * @returns Entidade atualizada.
   */
  update(id: string, props: UpdateProps): Promise<Model>;

  /**
   * Remove permanentemente uma entidade pelo seu id.
   * @param id - UUID da entidade a remover.
   */
  delete(id: string): Promise<void>;
}

/**
 * @interface IAlertsRepository
 * @description
 * Contrato genérico para persistência e consulta de alertas.
 *
 * Este contrato é usado pelo módulo Alerts e implementado na infraestrutura
 * (ex.: TypeORM/PostgreSQL).
 */
export interface IAlertsRepository<Model, CreateProps> {
  /**
   * Insere um alerta no armazenamento.
   */
  insert(props: CreateProps): Promise<Model>;

  /**
   * Insere um alerta apenas se não existir outro recente com o mesmo par
   * (clientId, tagName, desvio) na janela informada.
   *
   * @returns o alerta persistido ou `null` quando bloqueado por deduplicação.
   */
  insertIfNotRecent(props: CreateProps, dedupWindowMs: number): Promise<Model | null>;

  /**
   * Retorna os alertas mais recentes de um cliente.
   */
  findLatestByClient(clientId: string, limit?: number): Promise<Model[]>;

  /**
   * Retorna agregados de alertas de um cliente.
   */
  summarizeByClient(clientId: string): Promise<AlertSummaryOutput>;
}
