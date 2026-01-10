import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { embedColor } from '../config/config.js';
import { encode } from '../utils/3y3.js';
import { safeReply } from '../utils/coreUtils.js';
import { transcriptChannel } from '../utils/transcriptChannel.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

const finishedTranscripts =
  global.finishedTranscripts || (global.finishedTranscripts = new Set());

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function handleTranscriptTicket(interaction) {
  try {
    if (
      !interaction ||
      !interaction.guild ||
      !interaction.channel ||
      !interaction.user
    ) {
      triggerErrorEmbed(
        new Error('Interaction, guild, channel ou user manquant'),
        {
          action: 'handleTranscriptTicket',
          validation: 'missing_data',
        },
      );
      return;
    }

    if (interaction.replied || interaction.deferred) {
      triggerErrorEmbed(new Error('Interaction déjà traitée'), {
        action: 'handleTranscriptTicket',
        validation: 'already_processed',
      });
      return;
    }

    const language = interaction.customId?.split('_')?.pop() || 'fr';
    const localeFile = path.join(
      __dirname,
      '..',
      'locales',
      language,
      'tickets.json',
    );
    let translations;
    try {
      translations = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
    } catch (error) {
      triggerErrorEmbed(error, {
        action: 'handleTranscriptTicket',
        file: localeFile,
      });
      await safeReply(interaction, {
        content: 'Une erreur est survenue lors de la création du transcript.',
        flags: MessageFlags.Ephemeral,
      });
      translations = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '..', 'locales', 'fr', 'tickets.json'),
          'utf8',
        ),
      );
    }

    const logChannel = interaction.guild.channels.cache.find(
      (ch) =>
        ch &&
        ch.isTextBased &&
        ch.isTextBased() &&
        ch.topic &&
        ch.topic.includes(encode('log_tickets')),
    );

    await interaction.update({
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`openagain_ticket_${language}`)
            .setLabel(translations.buttons.reopen)
            .setStyle(ButtonStyle.Success)
            .setEmoji({ id: '1304519561814741063' }),
          new ButtonBuilder()
            .setCustomId(`delete_ticket_${language}`)
            .setLabel(translations.buttons.delete)
            .setStyle(ButtonStyle.Danger)
            .setEmoji({ id: '1304519593083011093' })
            .setDisabled(false),
          new ButtonBuilder()
            .setCustomId(`transcript_ticket_${language}`)
            .setLabel(translations.buttons.transcript)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji({ id: '1269193830524125277', animated: true }),
        ),
      ],
    });

    let transcriptHTML, transcriptUser, transcriptChannelObj;
    try {
      transcriptChannelObj = interaction.channel;
      transcriptUser = interaction.user;
      if (!transcriptChannelObj) throw new Error('Canal du ticket introuvable');
      if (!transcriptUser)
        throw new Error('Utilisateur du transcript introuvable');
      const transcriptResult = await transcriptChannel(
        transcriptChannelObj,
        transcriptUser,
        language,
      );
      transcriptHTML = transcriptResult.transcriptHTML;
    } catch (errTranscript) {
      triggerErrorEmbed(errTranscript, {
        command: 'handleTranscriptTicket-transcriptFallback',
        channelId: interaction?.channel?.id,
        userId: interaction?.user?.id,
      });
      transcriptHTML =
        '<html><body><h1>Transcript indisponible</h1></body></html>';
    }

    const action = language === 'fr' ? 'transcrit' : 'transcript';
    const actionText = translations.logs.title.replace('{action}', action);

    const userId = interaction?.user?.id || 'Utilisateur inconnu';
    const channelId = interaction?.channel?.id || 'Salon inconnu';
    const channelName = interaction?.channel?.name || 'Salon inconnu';
    const logTicketTranscriptedEmbed = {
      color: embedColor,
      title: actionText,
      description: translations.logs.description.replace('{action}', action),
      fields: [
        {
          name: translations.logs.ticketName,
          value: `#${channelName}`,
          inline: true,
        },
        {
          name: translations.logs.transcribedBy,
          value: userId !== 'Utilisateur inconnu' ? `<@${userId}>` : userId,
          inline: true,
        },
      ],
      timestamp: new Date(),
      footer: {
        text: translations.logs.footer,
      },
    };

    const logMessage = {
      embeds: [logTicketTranscriptedEmbed],
      files: [
        {
          attachment: Buffer.from(transcriptHTML),
          name: 'transcript.html',
        },
      ],
    };

    let transcriptSent = false;
    if (logChannel && typeof logChannel.send === 'function') {
      try {
        await logChannel.send(logMessage);
        transcriptSent = true;
        if (
          interaction.channel &&
          typeof interaction.channel.send === 'function'
        ) {
          await interaction.channel.send(
            language === 'fr' ?
              'Le transcript a été envoyé dans le salon de logs.'
            : 'The transcript has been sent to the logs channel.',
          );

          finishedTranscripts.add(interaction.channel.id);

          await interaction.update({
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`openagain_ticket_${language}`)
                  .setLabel(translations.buttons.reopen)
                  .setStyle(ButtonStyle.Success)
                  .setEmoji({ id: '1304519561814741063' }),
                new ButtonBuilder()
                  .setCustomId(`delete_ticket_${language}`)
                  .setLabel(translations.buttons.delete)
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji({ id: '1304519593083011093' })
                  .setDisabled(false),
                new ButtonBuilder()
                  .setCustomId(`transcript_ticket_${language}`)
                  .setLabel(translations.buttons.transcript)
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji({ id: '1269193830524125277', animated: true }),
              ),
            ],
          });
        }
      } catch (sendError) {
        triggerErrorEmbed(sendError, {
          action: 'handleTranscriptTicket',
          step: 'log_send',
          channelId,
          userId,
        });
      }
    }

    if (!transcriptSent) {
      try {
        if (
          interaction.channel &&
          typeof interaction.channel.send === 'function'
        ) {
          await interaction.channel.send(logMessage);
          await interaction.channel.send(
            language === 'fr' ?
              'Le transcript a été envoyé ici (fallback, logs indisponibles).'
            : 'The transcript has been sent here (fallback, logs unavailable).',
          );
          transcriptSent = true;
        }
      } catch (channelError) {
        triggerErrorEmbed(channelError, {
          action: 'handleTranscriptTicket',
          step: 'channel_fallback',
          channelId,
          userId,
        });

        try {
          if (interaction.user && typeof interaction.user.send === 'function') {
            await interaction.user.send(logMessage);
            await interaction.user.send(
              language === 'fr' ?
                'Le transcript a été envoyé en message privé (fallback).'
              : 'The transcript has been sent to your DM (fallback).',
            );
            transcriptSent = true;
          }
        } catch (dmError) {
          triggerErrorEmbed(dmError, {
            action: 'handleTranscriptTicket',
            step: 'dm_fallback',
            channelId,
            userId,
          });
        }
      }
    }

    if (!transcriptSent) {
      triggerErrorEmbed(
        new Error('Aucun fallback possible pour envoyer le transcript'),
        {
          action: 'handleTranscriptTicket',
          step: 'no_fallback_available',
          channelId,
          userId,
        },
      );
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'handleTranscriptTicket',
      guild: interaction?.guild?.name,
    });
    await safeReply(interaction, {
      content: 'Une erreur est survenue lors de la création du transcript.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

export { handleTranscriptTicket };

