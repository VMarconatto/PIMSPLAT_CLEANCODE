/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prettier/prettier */

/**
 * @file CreateUsers1768676034633.ts
 * @description
 * Migration responsável por criar a tabela `users`.
 *
 * Contexto arquitetural (Clean Architecture):
 * - Migrations pertencem à camada **infrastructure**, pois descrevem **detalhes de persistência** (schema do banco).
 * - Elas **não** implementam regras de negócio; apenas materializam a estrutura necessária para o domínio operar.
 *
 * Observações:
 * - Esta migration garante a extensão necessária para geração de UUIDs (quando aplicável).
 * - Define colunas essenciais para autenticação e perfil básico do usuário.
 */

import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreateUsers1768676034633 implements MigrationInterface {

  /**
   * Executa a criação da tabela `users`.
   *
   * O TypeORM chama este método quando você roda:
   * `migration:run`
   *
   * @param queryRunner - Abstração do TypeORM para executar comandos SQL e operações de schema.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * Garante que a extensão exista no banco.
     * - Em PostgreSQL, extensões podem habilitar funções utilitárias como geração de UUID.
     * - Mantemos a execução idempotente: "IF NOT EXISTS".
     */
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    /**
     * Cria a tabela `users` com os principais campos do usuário do sistema.
     * Colunas (visão de intenção):
     * - id: identificador único (UUID)
     * - name/email/password: credenciais e identidade
     * - avatar: opcional (perfil)
     * - created_at/update_at: auditoria básica (timestamps)
     *
     * Importante:
     * - Esta migration define a estrutura; validações e regras (ex.: formato de e-mail, força de senha)
     *   ficam na camada de **domain/application**.
     */
    await queryRunner.createTable(new Table({
      name: 'users',
      columns: [
        {
          name: 'id',
          type: 'uuid',
          isPrimary: true,
          default: 'gen_random_uuid()',
        },
        { name: 'name', type: 'varchar', length: '255' },
        { name: 'email', type: 'varchar', isUnique: true },
        { name: 'password', type: 'varchar' },
        { name: 'avatar', type: 'varchar', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'update_at', type: 'timestamptz', default: 'now()' },

      ],


    }))
  }

  /**
   * Reverte a migration (rollback).
   *
   * O TypeORM chama este método quando você roda:
   * `migration:revert`
   *
   * Aqui removemos a tabela criada no `up`.
   *
   * @param queryRunner - Executor de operações SQL/schema do TypeORM.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users')

  }
}
