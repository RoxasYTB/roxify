import { handleWebhookCreateRaid } from '../utils/handleWebhookRaid.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = 'webhookCreate';
export async function execute(webhook) {
  if (webhook.guild && shouldPauseGuild(webhook.guild.id)) {
    return;
  }

  try {
    await handleWebhookCreateRaid(webhook);
  } catch (error) {
    console.error("Erreur dans l'événement webhookCreate:", error);
  }
}

