import { MessageFlags } from 'discord.js';
import { embedColor } from '../config/config.js';
import { t } from '../locales/index.js';
import { encode } from '../utils/3y3.js';

const finishedTranscripts =
  global.finishedTranscripts || (global.finishedTranscripts = new Set());

async function handleDeleteTicket(interaction) {
  if (!finishedTranscripts.has(interaction.channel.id)) {
    return interaction.reply({
      content:
        "⛔️ Vous ne pouvez pas supprimer ce ticket tant que la transcription n'est pas terminée.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const name = interaction.channel.name;

  await interaction.channel.delete(
    `Ticket supprimé par ${interaction.user.tag} via interaction`,
  );

  const logChannel = interaction.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_tickets')),
  );
  const language = interaction.customId.split('_').pop() || 'fr';
  const action = language === 'fr' ? 'supprimé' : 'deleted';

  if (logChannel) {
    await logChannel.send({
      embeds: [
        {
          color: embedColor,
          title: t('tickets.logs.title', language, {
            action,
          }),
          description: t('tickets.logs.description', language, {
            action,
          }),
          fields: [
            {
              name: t('tickets.logs.ticketName', language),
              value: `#${name}`,
              inline: true,
            },
            {
              name: language === 'fr' ? `${action} par:` : `${action} by:`,
              value: `<@${interaction.user.id}>`,
              inline: true,
            },
          ],
          timestamp: new Date(),
          footer: {
            text: t('tickets.logs.footer', language),
          },
        },
      ],
    });
  }
}

export { handleDeleteTicket };

