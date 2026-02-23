/* eslint-disable prettier/prettier */
import { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateAlertsSamples1769012345678 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS alerts_samples (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id VARCHAR(255) NOT NULL,
        site VARCHAR(255) NOT NULL DEFAULT '',
        "timestamp" TIMESTAMPTZ NOT NULL,
        tag_name VARCHAR(255) NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        desvio VARCHAR(16) NOT NULL,
        alerts_count INTEGER NOT NULL DEFAULT 1,
        unidade VARCHAR(100) NOT NULL DEFAULT '',
        recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_samples_client_ts
      ON alerts_samples (client_id, "timestamp" DESC)
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_samples_client_tag_desvio_ts
      ON alerts_samples (client_id, tag_name, desvio, "timestamp" DESC)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_alerts_samples_client_ts')
    await queryRunner.query('DROP INDEX IF EXISTS idx_alerts_samples_client_tag_desvio_ts')
    await queryRunner.query('DROP TABLE IF EXISTS alerts_samples')
  }
}
