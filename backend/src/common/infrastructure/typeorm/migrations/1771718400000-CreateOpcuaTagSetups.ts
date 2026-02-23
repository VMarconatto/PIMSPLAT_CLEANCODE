/* eslint-disable prettier/prettier */
import { MigrationInterface, QueryRunner, Table, TableUnique } from 'typeorm'

/**
 * @file 1771718400000-CreateOpcuaTagSetups.ts
 * @description
 * Migration responsável pela criação da tabela `opcua_tag_setups`.
 *
 * Contexto:
 * - Esta tabela persiste a configuração de alarmes e metadados de tags OPC UA,
 *   substituindo os arquivos frágeis `Client01_setuptsconfig.json`.
 * - Cada linha representa a configuração de um único tag para um cliente específico.
 * - O par (client_name, tag_name) é único — garante que cada tag de cada cliente
 *   tenha exatamente um registro de setup.
 * - `client_name` referencia logicamente o campo `name` da tabela `opcua_clients`.
 */
export class CreateOpcuaTagSetups1771718400000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'opcua_tag_setups',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            /**
             * Nome lógico do cliente OPC UA (referência ao campo `name` de opcua_clients).
             * Não é FK formal para manter flexibilidade (clients podem ser removidos sem cascade).
             */
            name: 'client_name',
            type: 'varchar',
            length: '255',
          },
          {
            /**
             * Nome da tag (ex: "Tag_01", "Tag_02").
             * Chave dentro do objeto de setup retornado para o frontend.
             */
            name: 'tag_name',
            type: 'varchar',
            length: '255',
          },
          {
            /** Descrição legível da tag (ex: "Temperatura Pasteurizador"). */
            name: 'description',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            /** Unidade de medida (ex: "°C", "Bar", "%"). Campo `unidade` no JSON legado. */
            name: 'unit',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            /** Setpoint de alarme — limite inferior (SPAlarmL no JSON legado). */
            name: 'sp_alarm_l',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: true,
            default: 0,
          },
          {
            /** Setpoint de alarme — limite inferior crítico (SPAlarmLL no JSON legado). */
            name: 'sp_alarm_ll',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: true,
            default: 0,
          },
          {
            /** Setpoint de alarme — limite superior (SPAlarmH no JSON legado). */
            name: 'sp_alarm_h',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: true,
            default: 0,
          },
          {
            /** Setpoint de alarme — limite superior crítico (SPAlarmHH no JSON legado). */
            name: 'sp_alarm_hh',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: true,
            default: 0,
          },
          {
            /** Habilita/desabilita o alarme SPAlarmL. */
            name: 'sp_alarm_l_enabled',
            type: 'boolean',
            isNullable: true,
            default: false,
          },
          {
            /** Habilita/desabilita o alarme SPAlarmLL. */
            name: 'sp_alarm_ll_enabled',
            type: 'boolean',
            isNullable: true,
            default: false,
          },
          {
            /** Habilita/desabilita o alarme SPAlarmH. */
            name: 'sp_alarm_h_enabled',
            type: 'boolean',
            isNullable: true,
            default: false,
          },
          {
            /** Habilita/desabilita o alarme SPAlarmHH. */
            name: 'sp_alarm_hh_enabled',
            type: 'boolean',
            isNullable: true,
            default: false,
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
        uniques: [
          new TableUnique({
            name: 'UQ_opcua_tag_setups_client_tag',
            columnNames: ['client_name', 'tag_name'],
          }),
        ],
      }),
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('opcua_tag_setups')
  }
}
