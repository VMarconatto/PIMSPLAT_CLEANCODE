/* eslint-disable prettier/prettier */

/**
 * @file CreateUserTokens1768847601673.ts
 * @description
 * Migration responsável por criar a tabela `user_tokens`.
 *
 * Objetivo:
 * - Persistir tokens associados a usuários (ex.: reset de senha, refresh token, sessões, etc.)
 *
 * Contexto arquitetural:
 * - Esta é uma preocupação de **infraestrutura** (persistência).
 * - A regra sobre "quando emitir token", "quanto tempo vale", "como validar", etc.
 *   pertence ao **application/domain**; aqui só definimos o schema para suportar isso.
 *
 * Destaque:
 * - A tabela possui FK para `users` com CASCADE, garantindo integridade:
 *   se um usuário for removido, seus tokens também são removidos automaticamente.
 */

import { MigrationInterface, QueryRunner, Table } from 'typeorm'

export class CreateUserTokens1768847601673 implements MigrationInterface {

  /**
   * Cria a tabela `user_tokens` e a foreign key que referencia `users`.
   *
   * @param queryRunner - Executor de comandos/DDL do TypeORM.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * Garante extensão de UUID (PostgreSQL) para uso de uuid_generate_v4().
     * Idempotente para evitar falhas em múltiplas execuções.
     */
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    /**
     * Estrutura da tabela:
     * - id: PK UUID
     * - token: UUID gerado (pode ser usado como token de reset, etc.)
     * - user_id: referência ao usuário dono do token
     * - created_at/updated_at: auditoria simples
     */
    await queryRunner.createTable(
      new Table({
        name: 'user_tokens',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'token',
            type: 'uuid',
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
        
  },
        ],
        foreignKeys: [
          {
            /**
             * Nome da constraint de FK.
             * Útil para troubleshooting e para entender rapidamente o vínculo no banco.
             */
            name: 'TokenUser',

            /**
             * Referencia a tabela `users(id)`.
             * CASCADE:
             * - onDelete: remove tokens ao remover usuário
             * - onUpdate: acompanha alterações na PK (raras, mas mantém consistência)
             */
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            columnNames: ['user_id'],
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        ],
      }),
    )
  }

  /**
   * Rollback da criação da tabela `user_tokens`.
   *
   * @param queryRunner - Executor de comandos/DDL do TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_tokens')
  }
}
