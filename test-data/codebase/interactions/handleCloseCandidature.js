import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} from 'discord.js';
import { embedColor } from '../config/config.js';
import { t } from '../locales/index.js';
import { encode } from '../utils/3y3.js';

async function handleCloseCandidature(interaction) {
  const language = interaction.customId.split('_').pop() || 'fr';
  const sendLog = async (action) => {
    const logChannel = interaction.guild.channels.cache.find(
      (ch) =>
        ch.isTextBased() && ch.topic?.includes(encode('log_candidatures')),
    );
    if (logChannel) {
      await logChannel.send({
        embeds: [
          {
            color: embedColor,
            title: t('candidatures.logs.title', language, {
              action,
            }),
            description: t('candidatures.logs.description', language, {
              action,
            }),
            fields: [
              {
                name: t('candidatures.logs.candidatureName', language),
                value: `<#${interaction.channel.id}>`,
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
              text: t('candidatures.logs.footer', language),
            },
          },
        ],
      });
    }
  };

  await interaction.update({
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`openagain_candid_${language}`)
          .setLabel(t('candidatures.buttons.reopen', language))
          .setStyle(ButtonStyle.Success)
          .setEmoji({ id: '1304519561814741063' }),

        new ButtonBuilder()
          .setCustomId(`delete_candid_${language}`)
          .setLabel(t('candidatures.buttons.delete', language))
          .setStyle(ButtonStyle.Danger)
          .setEmoji({ id: '1304519593083011093' }),

        new ButtonBuilder()
          .setCustomId(`transcript_candid_${language}`)
          .setLabel(t('candidatures.buttons.transcript', language))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji({ id: '1269193830524125277', animated: true }),
      ),
    ],
  });

  await interaction.channel.permissionOverwrites.set([
    {
      id: interaction.guild.id,
      type: 0,
      deny: [
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.CreatePublicThreads,
        PermissionsBitField.Flags.CreatePrivateThreads,
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    {
      id: interaction.client.user.id,
      type: 1,
      allow: [
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.CreatePublicThreads,
        PermissionsBitField.Flags.CreatePrivateThreads,
      ],
    },
  ]);
  await sendLog(language === 'fr' ? 'fermée' : 'closed');
}

export { handleCloseCandidature };

