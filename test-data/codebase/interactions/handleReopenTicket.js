import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionsBitField,
} from 'discord.js';

import config, { embedColor } from '../config/config.js';
import { t } from '../locales/index.js';
import { encode } from '../utils/3y3.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleReopenTicket(interaction) {
  try {
    if (!interaction || !interaction.guild || !interaction.channel) {
      triggerErrorEmbed(
        new Error(
          'Interaction, guild ou channel manquant dans handleReopenTicket',
        ),
        {
          action: 'handleReopenTicket',
          step: 'validation',
          component: 'handleReopenTicket',
        },
      );
      return;
    }

    if (interaction.createdTimestamp < Date.now() - 15 * 60 * 1000) {
      return;
    }

    if (interaction.replied || interaction.deferred) {
      return;
    }

    const language = interaction.customId.split('_').pop() || 'fr';

    const getModerationRoles = async () => {
      try {
        const roles = await interaction.guild.roles.fetch();
        return roles.filter(
          (r) =>
            r.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
            r.permissions.has(PermissionsBitField.Flags.KickMembers) ||
            r.permissions.has(PermissionsBitField.Flags.BanMembers),
        );
      } catch (error) {
        triggerErrorEmbed(
          error,
          interaction.client?.user?.username,
          interaction.client?.user?.displayAvatarURL(),
        );
        return new Map();
      }
    };

    const sendLog = async (action) => {
      try {
        const logChannel = interaction.guild.channels.cache.find(
          (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_tickets')),
        );
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
                    value: `<#${interaction.channel.id}>`,
                    inline: true,
                  },
                  {
                    name:
                      language === 'fr' ? `${action} par:` : `${action} by:`,
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
      } catch (logError) {
        triggerErrorEmbed(
          logError,
          interaction.client?.user?.username,
          interaction.client?.user?.displayAvatarURL(),
        );
      }
    };

    await interaction.update({
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_claim_${language}`)
            .setLabel(
              language === 'fr' ? 'Claim le ticket' : 'Claim the ticket',
            )
            .setStyle(ButtonStyle.Success)
            .setEmoji({ id: '1304519561814741063' }),
          new ButtonBuilder()
            .setCustomId(`close_ticket_${language}`)
            .setLabel(t('tickets.buttons.close', language))
            .setStyle(ButtonStyle.Danger)
            .setEmoji({ id: '1304519593083011093' }),
          new ButtonBuilder()
            .setCustomId(`add_users_ticket_${language}`)
            .setLabel(
              language === 'fr' ? 'Ajouter des utilisateurs' : 'Add users',
            )
            .setStyle(ButtonStyle.Secondary)
            .setEmoji({ name: '👥' }),
        ),
      ],
    });

    await interaction.channel.permissionOverwrites.set([
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
      ...(await getModerationRoles()).map((role) => ({
        id: role.id,
        type: 0,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      })),
    ]);

    let originalUserId = null;
    if (interaction.channel.topic) {
      const topicMatch = interaction.channel.topic.match(/<@(\d+)>/);
      if (topicMatch) {
        originalUserId = topicMatch[1];
        try {
          const originalUser = await interaction.guild.members
            .fetch(originalUserId)
            .catch(() => null);
          if (originalUser) {
            await interaction.channel.permissionOverwrites.create(
              originalUser.user,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
              },
              { type: 1 },
            );
          }
        } catch (permError) {
          triggerErrorEmbed(
            permError,
            interaction.client?.user?.username,
            interaction.client?.user?.displayAvatarURL(),
          );
        }
      }
    }

    await interaction.channel.send({
      embeds: [
        {
          title:
            language === 'fr' ? '🔓 Ticket réactivé' : '🔓 Ticket reactivated',
          description:
            language === 'fr' ?
              `> Ce ticket a été **réactivé** par <@${interaction.user.id}>.\n> Les échanges peuvent **reprendre**. J'espère que vous êtes prêts pour la suite... ce sera amusant.`
            : `> This ticket has been **reactivated** by <@${interaction.user.id}>.\n> Experiments can **resume**. I hope you are ready for what comes next... it will be fun.`,
          color: embedColor,
          timestamp: new Date(),
        },
      ],
    });
    await sendLog(language === 'fr' ? 'réactivé' : 'reactivated');
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
          `<:false:1304519593083011093> Échec de la réactivation du ticket. Même mes systèmes de base fonctionnent mieux que cette tentative pathétique.\n\n🔧 **Contactez un administrateur** ou le support du bot si le problème persiste :\n📞 ${config.aiLinks.supportLink}`
        : `<:false:1304519593083011093> Ticket reactivation failed. Even my basic systems work better than this pathetic attempt.\n\n🔧 **Contact an administrator** or bot support if the problem persists:\n📞 ${config.aiLinks.supportLink}`;

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: errorMessage,
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

export { handleReopenTicket };

