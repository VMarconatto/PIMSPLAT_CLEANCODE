/* eslint-disable prettier/prettier */
import 'dotenv/config'
import { z } from 'zod'

/**
 * @file index.ts
 * @description
 * Módulo responsável por carregar, validar e tipar as variáveis de ambiente da aplicação.
 *
 * Estratégia adotada:
 * - Usa `dotenv` para carregar variáveis do arquivo `.env` para `process.env`
 * - Usa `zod` para:
 *   - validar formato e obrigatoriedade das variáveis
 *   - aplicar valores default
 *   - inferir tipos de forma segura
 *
 * Este módulo garante que:
 * - a aplicação falhe rapidamente (fail-fast) caso o ambiente esteja inválido
 * - o restante do código trabalhe apenas com variáveis já validadas e tipadas
 *
 * Arquitetura:
 * - pertence à camada de Infrastructure
 * - deve ser importado apenas em pontos de bootstrap/configuração
 * - não deve ser usado diretamente pelo Domain
 */

/**
 * @constant envSchema
 * @description
 * Schema Zod que define todas as variáveis de ambiente esperadas pela aplicação.
 *
 * Cada campo:
 * - valida o tipo
 * - define defaults quando aplicável
 * - garante coerência em runtime
 */
export const envSchema = z.object({
  /**
   * Ambiente de execução da aplicação.
   */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /**
   * Porta HTTP onde a API será exposta.
   */
  PORT: z.coerce.number().default(3333),

  /**
   * URL base da API (útil para links, callbacks, etc.).
   */
  API_URL: z.string().default('http://localhost:3333'),

  /**
   * Tipo do banco de dados utilizado.
   * Atualmente fixado como `postgres`.
   */
  DB_TYPE: z.literal('postgres').default('postgres'),

  /**
   * Host do banco de dados.
   */
  DB_HOST: z.string().default('localhost'),

  /**
   * Porta do banco de dados.
   */
  DB_PORT: z.coerce.number().default(5432),

  /**
   * Schema padrão do banco.
   */
  DB_SCHEMA: z.string().default('public'),

  /**
   * Nome do banco de dados.
   */
  DB_NAME: z.string().default('postgres'),

  /**
   * Usuário do banco de dados.
   */
  DB_USER: z.string().default('postgres'),

  /**
   * Senha do banco de dados.
   */
  DB_PASS: z.string().default('postgres'),

  /**
   * Segredo usado para assinar/verificar tokens JWT.
   * Obrigatório (sem default).
   */
  JWT_SECRET: z.string(),

  /**
   * Tempo de expiração do token JWT, em segundos.
   */
  JWT_EXPIRES_IN: z.coerce.number().default(86400),

  /**
   * Chave de autenticação para a API HTTP.
   * Opcional em dev/test, obrigatória em produção (validada no middleware).
   */
  API_KEY: z.string().optional(),
})

/**
 * Resultado da validação das variáveis de ambiente.
 * Usa `safeParse` para evitar exceções automáticas do Zod
 * e permitir tratamento explícito do erro.
 */
const __env = envSchema.safeParse(process.env)

/**
 * Fail-fast:
 * Se alguma variável obrigatória estiver ausente ou inválida,
 * a aplicação é interrompida imediatamente.
 */
if (__env.success === false) {
  throw new Error('Invalid environment variables')
}

/**
 * @constant env
 * @description
 * Objeto contendo todas as variáveis de ambiente já:
 * - validadas
 * - tipadas
 * - com valores default aplicados
 *
 * Este objeto deve ser utilizado no lugar de `process.env`.
 *
 * @example
 * import { env } from '@/common/infrastructure/env'
 *
 * console.log(env.DB_HOST)
 */
export const env = __env.data
