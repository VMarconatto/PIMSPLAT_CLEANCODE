import amqp, { Channel, ConfirmChannel, Connection } from 'amqplib'
import fs from 'node:fs'
import { rabbitConfig } from '../config/rabbit.js'
import pino from 'pino'

/**
 * @file rabbitmq.connection.ts
 * @module infrastructure/rabbit/rabbitmq.connection
 *
 * @description
 * Implementa a **camada de conectividade AMQP** com RabbitMQ para a aplicação.
 *
 * Este módulo é “plumbing” (infraestrutura pura): ele **não** contém regra de negócio,
 * **não** conhece OPC UA, **não** sabe de banco de dados, e **não** manipula envelopes.
 *
 * O papel dele é garantir que exista **uma conexão e um canal utilizáveis**
 * para os módulos de:
 * - publishing (producer)
 * - consuming (worker)
 * - setup da topologia (exchange/queues/bindings)
 *
 * ───────────────────────────────────────────────────────────────
 *  Por que este arquivo existe?
 * ───────────────────────────────────────────────────────────────
 * Em ambientes industriais (chão de fábrica), é comum ocorrer:
 * - oscilações rápidas de rede (link “pisca”)
 * - reinícios do broker (manutenção, atualização, crash)
 * - containers reiniciando
 *
 * Este módulo foi desenhado para que o serviço **se recupere sozinho**
 * sem precisar de intervenção humana.
 *
 * ───────────────────────────────────────────────────────────────
 *  Responsabilidades
 * ───────────────────────────────────────────────────────────────
 * - Criar conexão AMQP (amqp.connect)
 * - Criar Channel ou ConfirmChannel (publisher confirms)
 * - Cache em memória (singleton simples) de conexão/canal
 * - Reconexão automática com backoff (retry progressivo)
 * - Listeners de 'close' e 'error' para invalidar cache e observar falhas
 * - Suporte a TLS (AMQPS e/ou mTLS) via socket options
 *
 * ───────────────────────────────────────────────────────────────
 *  Não-responsabilidades
 * ───────────────────────────────────────────────────────────────
 * - Não faz assert de exchange/queue (isso é rabbitmq.setup.ts)
 * - Não faz publish (isso é publisher.ts)
 * - Não faz consume (isso é consumer.ts)
 * - Não faz persistência em banco
 *
 * ───────────────────────────────────────────────────────────────
 *  Observação sobre concorrência
 * ───────────────────────────────────────────────────────────────
 * Este módulo utiliza uma flag `connecting` para evitar múltiplas conexões
 * concorrentes. Se uma chamada já estiver conectando, as próximas aguardam.
 */

const log = pino({ name: 'rabbitmq' })

/**
 * @typedef AnyChannel
 * @description
 * Canal AMQP retornado por este módulo.
 *
 * Pode ser:
 * - `Channel` (canal padrão)
 * - `ConfirmChannel` (canal com confirmação de publicação)
 *
 * @remarks
 * Quando `rabbitConfig.publishConfirm=true`, usamos ConfirmChannel para permitir
 * `waitForConfirms()` no publisher e aumentar segurança contra perda de mensagens.
 */
type AnyChannel = Channel | ConfirmChannel

/**
 * @description
 * Conexão AMQP mantida em memória (singleton).
 *
 * @remarks
 * - `null` significa “não conectado / inválido”.
 * - É resetado para `null` em eventos de 'close'.
 */
let conn: Connection | null = null

/**
 * @description
 * Canal AMQP mantido em memória (singleton).
 *
 * @remarks
 * - Criado a partir da conexão `conn`.
 * - Pode ser Channel ou ConfirmChannel conforme configuração.
 * - É resetado para `null` quando a conexão cai.
 */
let channel: AnyChannel | null = null

/**
 * @description
 * Flag de proteção contra múltiplas tentativas concorrentes de conexão.
 *
 * @remarks
 * Evita cenários onde:
 * - 10 módulos chamam getRabbitConnection() simultaneamente
 * - e cada um tenta abrir sua própria conexão/canal
 *
 * Com isso, uma “primeira chamada” conecta e as demais aguardam.
 */
let connecting = false

/**
 * Suspende a execução pelo tempo indicado.
 *
 * @param ms Tempo em milissegundos.
 * @returns Promise<void>
 *
 * @remarks
 * Usado para implementar backoff no laço de reconexão e também no modo “aguardar quem está conectando”.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Monta as opções de socket TLS para conexão AMQPS/mTLS, quando habilitado.
 *
 * @returns
 * - `undefined` se TLS estiver desabilitado
 * - Objeto com `ca/cert/key` quando TLS estiver habilitado
 *
 * @remarks
 * Este método suporta os cenários:
 * - AMQPS com CA (validação do broker)
 * - mTLS com cert/key do cliente (autenticação mútua)
 *
 * @important
 * - Os caminhos (`caPath`, `certPath`, `keyPath`) vêm de `rabbitConfig`.
 * - Se algum caminho estiver ausente, o respectivo item fica `undefined`.
 * - `servername` fica undefined por padrão; se precisar SNI, configure hostname.
 */
function buildSocketOptions() {
  if (!rabbitConfig.tls.enabled) return undefined

  const ca = rabbitConfig.tls.caPath ? fs.readFileSync(rabbitConfig.tls.caPath) : undefined
  const cert = rabbitConfig.tls.certPath ? fs.readFileSync(rabbitConfig.tls.certPath) : undefined
  const key = rabbitConfig.tls.keyPath ? fs.readFileSync(rabbitConfig.tls.keyPath) : undefined

  return {
    ca: ca ? [ca] : undefined,
    cert,
    key,
    servername: undefined // se precisar SNI, setar hostname
  }
}

/**
 * Retorna uma conexão e um canal prontos para uso.
 *
 * @function getRabbitConnection
 * @returns Promise<{ conn: Connection; channel: AnyChannel }>
 * Objeto contendo a conexão AMQP e um canal ativo.
 *
 * @remarks
 * Regras de funcionamento:
 *
 * 1) Cache (fast-path)
 *    - Se `conn` e `channel` já existem, retorna imediatamente.
 *
 * 2) Proteção contra concorrência
 *    - Se `connecting=true`, aguarda até que alguém finalize a conexão.
 *
 * 3) Reconexão automática
 *    - Se não existe conexão/canal, tenta conectar em loop,
 *      com backoff progressivo (limitado a 30s).
 *
 * 4) Observabilidade e invalidation
 *    - on('close') invalida o cache (conn/channel = null).
 *    - on('error') loga erros para troubleshooting.
 *
 * ───────────────────────────────────────────────────────────────
 *  Por que isso é crítico em produção?
 * ───────────────────────────────────────────────────────────────
 * - Publisher e Consumer dependem de um canal saudável.
 * - Se a conexão cair, o serviço precisa se recuperar sozinho.
 * - Evita downtime prolongado por falhas transitórias.
 *
 * ───────────────────────────────────────────────────────────────
 *  Comportamento em caso de falha
 * ───────────────────────────────────────────────────────────────
 * Se a conexão falhar:
 * - loga o erro
 * - reseta conn/channel
 * - espera backoff
 * - tenta novamente
 *
 * Isso significa que a Promise pode demorar para resolver enquanto
 * o RabbitMQ estiver indisponível — comportamento desejado em serviços
 * que devem “auto-heal”.
 */
export async function getRabbitConnection(): Promise<{ conn: Connection; channel: AnyChannel }> {
  if (conn && channel) return { conn, channel }

  if (connecting) {
    /**
     * Aguarda a conclusão da conexão iniciada por outra chamada.
     * Poll simples, suficiente para evitar corrida.
     */
    while (!conn || !channel) await sleep(200)
    return { conn, channel }
  }

  connecting = true

  let attempt = 0
  while (!conn || !channel) {
    attempt++
    try {
      log.info({ attempt }, 'Connecting to RabbitMQ...')

      /**
       * Cria conexão AMQP com heartbeat e opções TLS (quando aplicável).
       *
       * @note
       * Heartbeat ajuda a detectar conexões “meio-mortas” e acelerar recuperação.
       */
      conn = await amqp.connect(rabbitConfig.url, {
        heartbeat: rabbitConfig.heartbeat,
        ...buildSocketOptions()
      })

      /**
       * Em 'close', invalidamos o cache para forçar reconexão
       * em chamadas futuras.
       */
      conn.on('close', () => {
        log.warn('RabbitMQ connection closed')
        conn = null
        channel = null
      })

      /**
       * Em 'error', apenas observamos/logamos.
       * (O 'close' é o evento que sinaliza ruptura total.)
       */
      conn.on('error', (err) => {
        log.error({ err }, 'RabbitMQ connection error')
      })

      /**
       * Cria o canal de comunicação.
       *
       * - Channel: padrão
       * - ConfirmChannel: permite publisher confirms (maior confiabilidade)
       */
      channel = rabbitConfig.publishConfirm
        ? await conn.createConfirmChannel()
        : await conn.createChannel()

      channel.on('close', () => log.warn('RabbitMQ channel closed'))
      channel.on('error', (err) => log.error({ err }, 'RabbitMQ channel error'))

      log.info('RabbitMQ connected')
    } catch (err) {
      /**
       * Falha na conexão/criação de canal.
       * Reseta cache e tenta novamente com backoff progressivo.
       */
      log.error({ err, attempt }, 'Failed to connect. Retrying...')
      conn = null
      channel = null

      /**
       * Backoff simples:
       * - cresce 1s por tentativa
       * - limitado a 30s para não “explodir” em ambientes instáveis
       */
      const backoff = Math.min(30_000, 1000 * attempt)
      await sleep(backoff)
    }
  }

  connecting = false
  return { conn, channel }
}
