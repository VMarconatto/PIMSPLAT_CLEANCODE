/* eslint-disable prettier/prettier */

import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * @file 1771632000000-AddColumnsToOpcuaClients.ts
 * @description
 * Migration responsável por adicionar os campos de configuração OPC UA
 * à tabela `opcua_clients` existente.
 *
 * Contexto:
 * - A migration `1768323320214-CreateOpcuaClients.ts` criou a tabela com campos básicos
 *   (id, name, endpoint, description, is_active, created_at, updated_at).
 * - Esta migration adiciona os campos restantes necessários para substituir o
 *   `opcuaClientConfig.json` com persistência robusta no banco de dados.
 * - Usa `ADD COLUMN IF NOT EXISTS` para ser idempotente em ambiente de desenvolvimento.
 *
 * Campos adicionados:
 * - application_name: nome de exibição da aplicação OPC UA
 * - initial_delay: delay inicial antes da primeira tentativa de conexão (ms)
 * - max_retry: número máximo de tentativas de reconexão
 * - max_delay: delay máximo entre tentativas de reconexão (ms)
 * - security_mode: modo de segurança OPC UA (1=None, 2=Sign, 3=SignAndEncrypt)
 * - security_policy: política de segurança OPC UA (0=None, 1=Basic128, 2=Basic256...)
 * - map_memory: NodeIds a monitorar (JSONB array de strings)
 * - namespace: namespace padrão para os NodeIds
 *
 * Pertence à camada de Infrastructure (TypeORM migrations).
 */
export class AddColumnsToOpcuaClients1771632000000 implements MigrationInterface {

  /**
   * Adiciona as colunas de configuração OPC UA à tabela `opcua_clients`.
   *
   * @param queryRunner - Executor de queries e operações da migration.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE opcua_clients
        ADD COLUMN IF NOT EXISTS application_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS initial_delay    INTEGER,
        ADD COLUMN IF NOT EXISTS max_retry        INTEGER,
        ADD COLUMN IF NOT EXISTS max_delay        INTEGER,
        ADD COLUMN IF NOT EXISTS security_mode    INTEGER,
        ADD COLUMN IF NOT EXISTS security_policy  INTEGER,
        ADD COLUMN IF NOT EXISTS map_memory       JSONB,
        ADD COLUMN IF NOT EXISTS namespace        INTEGER
    `)
  }

  /**
   * Reverte a migration removendo as colunas adicionadas.
   *
   * @param queryRunner - Executor de queries e operações da migration.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE opcua_clients
        DROP COLUMN IF EXISTS application_name,
        DROP COLUMN IF EXISTS initial_delay,
        DROP COLUMN IF EXISTS max_retry,
        DROP COLUMN IF EXISTS max_delay,
        DROP COLUMN IF EXISTS security_mode,
        DROP COLUMN IF EXISTS security_policy,
        DROP COLUMN IF EXISTS map_memory,
        DROP COLUMN IF EXISTS namespace
    `)
  }
}
