/* eslint-disable prettier/prettier */
import { MigrationInterface, QueryRunner, Table } from 'typeorm'

/**
 * @file 1768323320214-CreateOpcuaClients.ts
 * @description
 * Migration responsável pela criação da tabela `opcua_clients`.
 *
 * Contexto:
 * - Esta tabela registra os OPC UA clients configurados na aplicação.
 * - Cada client representa uma conexão a um servidor OPC UA (ex: Device01, Device02).
 * - O campo `name` é o identificador lógico usado em todo o pipeline:
 *   OPC UA → RabbitMQ → Consumer → PostgreSQL.
 * - Cada client terá sua própria tabela de telemetria (criada dinamicamente),
 *   mas este registro serve como catálogo/configuração central.
 *
 * Pertence à camada de Infrastructure (TypeORM migrations).
 */
export class CreateOpcuaClients1768323320214 implements MigrationInterface {

  /**
   * Cria a tabela `opcua_clients`.
   *
   * @param queryRunner - Executor de queries e operações da migration.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    await queryRunner.createTable(
      new Table({
        name: 'opcua_clients',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            /**
             * Nome lógico do client (ex: "Device01", "Client01").
             * Único — usado como identificador em todo o pipeline
             * e como referência para a tabela de telemetria dedicada.
             */
            name: 'name',
            type: 'varchar',
            length: '255',
            isUnique: true,
          },
          {
            /**
             * Endpoint OPC UA do servidor ao qual este client se conecta.
             * Ex: "opc.tcp://192.168.1.100:4840"
             */
            name: 'endpoint',
            type: 'varchar',
            length: '500',
          },
          {
            /**
             * Descrição livre do client (planta, linha, equipamento, etc.).
             */
            name: 'description',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            /**
             * Indica se o client está ativo (deve ser inicializado no bootstrap).
             */
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
    )
  }

  /**
   * Reverte a migration.
   *
   * @param queryRunner - Executor de queries e operações da migration.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('opcua_clients')
  }
}
