/**
 * @file emailService.ts
 * @description
 * Serviço de envio de alertas industriais por e-mail via SMTP,
 * configurado para Gmail ou qualquer provedor compatível com Nodemailer.
 *
 * @remarks
 * **Variáveis de ambiente obrigatórias:**
 * - `ALERT_EMAIL_USER` — endereço de e-mail do remetente (conta Gmail ou SMTP).
 * - `ALERT_EMAIL_PASS` — senha ou **App Password** da conta (obrigatório para
 *   Gmail com 2FA ativo; senhas comuns são rejeitadas desde mai/2022).
 *
 * **Variável de ambiente opcional:**
 * - `ALERT_EMAIL_DESTINATION` — destinatário padrão quando o parâmetro `to`
 *   não for fornecido na chamada de {@link sendEmailAlert}.
 *
 * **Lazy init:** O `Transporter` Nodemailer é criado na primeira chamada de
 * {@link sendEmailAlert} e reutilizado em todas as chamadas subsequentes,
 * evitando overhead de criação de conexão a cada envio.
 *
 * @module alerts/infrastructure/notifications/email/emailService
 */

import nodemailer, { Transporter } from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

/**
 * Instância singleton do transporter Nodemailer.
 *
 * @remarks
 * Inicializado de forma lazy na primeira chamada de {@link sendEmailAlert}.
 * Mantido em escopo de módulo para reutilização entre chamadas.
 */
let transporter: Transporter;

/**
 * Cria e retorna um transporter SMTP autenticado via Nodemailer.
 *
 * @remarks
 * Configurado para o serviço `"gmail"` por padrão. Para outros provedores SMTP,
 * substitua `service` por `host` + `port` + `secure` conforme a documentação
 * do Nodemailer.
 *
 * As credenciais são lidas das variáveis de ambiente:
 * - `ALERT_EMAIL_USER` → usuário/remetente SMTP.
 * - `ALERT_EMAIL_PASS` → senha ou App Password SMTP.
 *
 * @returns {Transporter} Instância de `Transporter` pronta para envio de e-mails.
 */
function createTransporter(): Transporter {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.ALERT_EMAIL_USER,
      pass: process.env.ALERT_EMAIL_PASS,
    },
  });
}

/**
 * Envia um e-mail de alerta com corpo em texto simples.
 *
 * @remarks
 * **Fluxo de execução:**
 * 1. Inicializa o transporter na primeira chamada (lazy init).
 * 2. Resolve o destinatário: usa `to` se fornecido, caso contrário usa
 *    `ALERT_EMAIL_DESTINATION` (env). Lança erro se nenhum dos dois estiver disponível.
 * 3. Verifica se `ALERT_EMAIL_USER` está configurado (remetente obrigatório).
 * 4. Envia o e-mail via SMTP e registra o `messageId` no console em caso de sucesso.
 *
 * **Tratamento de erros:** Erros de envio são capturados e registrados no console
 * (`console.error`). A função **não relança** o erro, garantindo que falhas de
 * e-mail não interrompam o fluxo principal do scheduler ou consumer.
 *
 * @param {string}  subject    - Assunto do e-mail (ex.: `'Alerta: TEMP_REACTOR_01 (plant-A)'`).
 * @param {string}  body       - Corpo da mensagem em texto puro (sem HTML).
 * @param {string}  [to]       - Endereço(s) de destino separados por vírgula.
 *   Quando omitido, utiliza `ALERT_EMAIL_DESTINATION` (variável de ambiente).
 *
 * @returns {Promise<void>} Resolve após o envio bem-sucedido (sem valor de retorno).
 *
 * @throws {Error} Quando `to` e `ALERT_EMAIL_DESTINATION` estão ambos ausentes.
 * @throws {Error} Quando `ALERT_EMAIL_USER` não está configurado.
 *
 * @example
 * ```typescript
 * // Envio com destinatário explícito
 * await sendEmailAlert(
 *   'Alerta: TEMP_REACTOR_01 (plant-A)',
 *   'Temperatura acima do limite HH: 210.5 °C',
 *   'ops@company.com',
 * )
 *
 * // Envio usando destinatário padrão do ambiente
 * await sendEmailAlert(
 *   'Alerta de Pressão',
 *   'Pressão abaixo do limite LL: 0.8 bar',
 * )
 * ```
 */
export async function sendEmailAlert(
  subject: string,
  body: string,
  to?: string
): Promise<void> {
  try {
    /** Lazy init: cria o transporter apenas na primeira chamada. */
    if (!transporter) transporter = createTransporter();

    const toAddress = to || process.env.ALERT_EMAIL_DESTINATION;
    if (!toAddress) {
      throw new Error(
        "Destinatário não definido (ALERT_EMAIL_DESTINATION ausente e parâmetro 'to' vazio)."
      );
    }

    if (!process.env.ALERT_EMAIL_USER) {
      throw new Error(
        "Remetente não configurado (ALERT_EMAIL_USER ausente)."
      );
    }

    const info = await transporter.sendMail({
      from: `"OPCUA Alertas" <${process.env.ALERT_EMAIL_USER}>`,
      to: toAddress,
      subject,
      text: body,
    });

    console.log("Email enviado com sucesso:", info.messageId);
  } catch (error) {
    // Não relança: falhas de e-mail não devem interromper o scheduler/consumer
    console.error("Falha ao enviar email:", error);
  }
}
