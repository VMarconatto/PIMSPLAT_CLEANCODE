/* eslint-disable prettier/prettier */
import { DataSource } from 'typeorm'
import { env } from '../env/index.js'

/**
 * @file typeorm/index.ts
 * @description
 * Configuração e instância do DataSource (TypeORM) para PostgreSQL.
 *
 * Papel no backend industrial:
 * - Fornecer conexão compartilhada e confiável com PostgreSQL
 * - Ser agnóstico do domínio (não sabe o que é Telemetry, Users, etc.)
 * - Gerenciar migrations e entidades registradas
 *
 * Observações:
 * - O DataSource é singleton de processo (inicializado uma vez no bootstrap).
 * - Migrations ficam neste mesmo diretório, em `./migrations/`.
 * - Entidades são registradas por cada módulo ao importar este DataSource.
 */

/**
 * @constant dataSource
 * @description
 * Instância do DataSource do TypeORM configurada para PostgreSQL.
 *
 * Utiliza variáveis de ambiente validadas pelo Zod (env):
 * - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, DB_SCHEMA
 *
 * Migrations são carregadas automaticamente do diretório `./migrations/`.
 */
export const dataSource = new DataSource({
  type: env.DB_TYPE,
  host: env.DB_HOST,
  port: env.DB_PORT,
  schema: env.DB_SCHEMA,
  database: env.DB_NAME,
  username: env.DB_USER,
  password: env.DB_PASS,
  entities: [
    __dirname + '/../../../users/infrastructure/typeorm/entities/*.{ts,js}',
    __dirname + '/../../../alerts/infrastructure/typeorm/entities/*.{ts,js}',
  ],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  logging: env.NODE_ENV === 'development',
})
