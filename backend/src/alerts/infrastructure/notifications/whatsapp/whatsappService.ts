/**
 * @file whatsappService.ts
 * @description
 * Serviço de envio de mensagens de alerta industrial via API oficial do
 * WhatsApp Business (360Dialog), utilizando o protocolo HTTP REST.
 *
 * @remarks
 * **Pré-requisitos:**
 * - Conta ativa na plataforma **360Dialog** com canal WhatsApp Business aprovado.
 * - Variável de ambiente `WHATSAPP_API_TOKEN` configurada com o token Bearer
 *   fornecido pelo 360Dialog.
 * - Número de destino `TO_PHONE` configurado no formato **E.164**:
 *   `55` (DDI Brasil) + DDD (2 dígitos) + número (8 ou 9 dígitos).
 *   Exemplo: `"5511987654321"`.
 *
 * **Limitações conhecidas:**
 * - O número de destino (`TO_PHONE`) está hardcoded no módulo; para suporte
 *   a múltiplos destinatários dinâmicos, refatore para receber o número como
 *   parâmetro de {@link sendWhatsAppMessage}.
 * - Apenas mensagens de texto simples são suportadas; para templates aprovados
 *   pela Meta (ex.: notificações estruturadas), a estrutura do body da requisição
 *   deve ser adaptada conforme a documentação do 360Dialog.
 *
 * @module alerts/infrastructure/notifications/whatsapp/whatsappService
 */

import axios from "axios";

/**
 * Endpoint da API REST do 360Dialog para envio de mensagens WhatsApp Business.
 *
 * @remarks
 * Documentação oficial: https://docs.360dialog.com/whatsapp-api/whatsapp-api/media
 */
const API_URL = "https://waba.360dialog.io/v1/messages";

/**
 * Token de autenticação Bearer para a API do 360Dialog.
 *
 * @remarks
 * Lido da variável de ambiente `WHATSAPP_API_TOKEN`.
 * O operador `!` (non-null assertion) indica que a ausência deste token
 * causará falha na requisição HTTP (401 Unauthorized).
 */
const WHATSAPP_TOKEN = process.env.WHATSAPP_API_TOKEN!;

/**
 * Número de telefone de destino no formato E.164 (DDI + DDD + número).
 *
 * @remarks
 * Substitua pelo número de destino real antes de usar em produção.
 * Formato: `"55XXXXXXXXXXX"` onde `55` = DDI Brasil, seguido de DDD + número.
 */
const TO_PHONE = "55XXXXXXXXXXX";

/**
 * Envia uma mensagem de texto simples via API WhatsApp Business (360Dialog).
 *
 * @remarks
 * **Fluxo de execução:**
 * 1. Realiza um `POST` para `API_URL` com o payload de mensagem de texto.
 * 2. O header `Authorization: Bearer <WHATSAPP_API_TOKEN>` autentica a requisição.
 * 3. Em caso de sucesso, registra confirmação no console.
 * 4. Em caso de erro (rede, autenticação, rate limit), registra o erro no console
 *    **sem relançá-lo**, evitando crash do scheduler ou consumer que invoca esta função.
 *
 * **Payload enviado à API:**
 * ```json
 * {
 *   "to": "55XXXXXXXXXXX",
 *   "type": "text",
 *   "text": { "body": "<mensagem>" }
 * }
 * ```
 *
 * @param {string} body - Texto da mensagem a ser enviada (sem formatação especial).
 * @returns {Promise<void>} Resolve após a tentativa de envio (com ou sem erro).
 *
 * @example
 * ```typescript
 * await sendWhatsAppMessage(
 *   'ALERTA: TEMP_REACTOR_01 (plant-A) — valor 210.5 °C excede limite HH!'
 * )
 * ```
 */
export async function sendWhatsAppMessage(body: string): Promise<void> {
  try {
    // Endpoint oficial do 360Dialog (conector do WhatsApp Business)
    await axios.post(
      API_URL,
      {
        to: TO_PHONE,
        type: "text",
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Alerta enviado via WhatsApp");
  } catch (error) {
    // Não relança: falhas de notificação não devem interromper o scheduler
    console.error(`Erro ao enviar mensagem WhatsApp: ${error}`);
  }
}
