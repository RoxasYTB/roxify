import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionsBitField,
} from 'discord.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../config/config.js';
import { encode } from '../utils/3y3.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function handleReopenCandidature(interaction) {
  try {
    if (!interaction || !interaction.guild || !interaction.channel) {
      return;
    }

    const language = interaction.customId.split('_').pop() || 'fr';
    const localeFile = path.join(
      __dirname,
      '..',
      'locales',
      language,
      'candidatures.json',
    );

    let translations;
    try {
      const localeData = fs.readFileSync(localeFile, 'utf8');
      translations = JSON.parse(localeData);
    } catch (error) {
      triggerErrorEmbed(
        error,
        interaction.client?.user?.username,
        interaction.client?.user?.displayAvatarURL(),
      );
      const fallbackFile = path.join(
        __dirname,
        '..',
        'locales',
        'fr',
        'candidatures.json',
      );
      const fallbackData = fs.readFileSync(fallbackFile, 'utf8');
      translations = JSON.parse(fallbackData);
    }

    let userId;
    if (interaction.channel.topic && interaction.channel.topic.includes('<@')) {
      userId = interaction.channel.topic.split('<@')[1].split('>')[0];
    } else {
      triggerErrorEmbed(
        "Impossible de retrouver l'utilisateur lié à cette candidature.",
        interaction.client?.user?.username,
        interaction.client?.user?.displayAvatarURL(),
      );
      return interaction.reply({
        content: translations.errors.userNotFound,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const basePermissions = [
        {
          id: interaction.guild.id,
          type: 0,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: interaction.client.user.id,
          type: 1,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ];

      const user = await interaction.guild.members
        .fetch(userId)
        .catch(() => null);
      if (user) {
        basePermissions.push({
          id: userId,
          type: 1,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        });
      }

      await Promise.all([
        interaction.update({
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`close_candid_${language}`)
                .setLabel(translations.buttons.close)
                .setStyle(ButtonStyle.Danger)
                .setEmoji({ id: '1304519593083011093' }),
            ),
          ],
        }),
        interaction.channel.send({
          content: translations.messages.openAgain,
        }),
        interaction.channel.permissionOverwrites.set(basePermissions),
      ]);
    } catch (updateError) {
      triggerErrorEmbed(
        updateError,
        interaction.client?.user?.username,
        interaction.client?.user?.displayAvatarURL(),
      );
      throw updateError;
    }

    const logChannel = interaction.guild.channels.cache.find(
      (ch) =>
        ch.isTextBased() && ch.topic?.includes(encode('log_candidatures')),
    );

    if (logChannel) {
      try {
        const action = language === 'fr' ? 'réouverte' : 'reopened';
        const actionText = translations.logs.title.replace('{action}', action);
        await logChannel.send({
          embeds: [
            {
              color: embedColor,
              title: actionText,
              description: translations.logs.description.replace(
                '{action}',
                action,
              ),
              fields: [
                {
                  name: translations.logs.candidatureName,
                  value: `<#${interaction.channel.id}>`,
                  inline: true,
                },
                {
                  name: translations.info.reopenedBy
                    .split('<@{userId}>')[0]
                    .trim(),
                  value: `<@${interaction.user.id}>`,
                  inline: true,
                },
              ],
              timestamp: new Date(),
              footer: {
                text: translations.logs.footer,
              },
            },
          ],
        });
      } catch (logError) {
        triggerErrorEmbed(
          logError,
          interaction.client?.user?.username,
          interaction.client?.user?.displayAvatarURL(),
        );
      }
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      interaction.client?.user?.username,
      interaction.client?.user?.displayAvatarURL(),
    );

    try {
      const language = interaction?.customId?.split('_')?.pop() || 'fr';
      const errorMessage =
        language === 'fr' ?
          '<:false:1304519593083011093> Erreur lors de la réouverture de la candidature.'
        : '<:false:1304519593083011093> Error reopening the application.';

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      triggerErrorEmbed(
        replyError,
        interaction.client?.user?.username,
        interaction.client?.user?.displayAvatarURL(),
      );
    }
  }
}

export { handleReopenCandidature };

