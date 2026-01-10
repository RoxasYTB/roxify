import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionsBitField,
} from 'discord.js';

import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { safeExecute, safeReply } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleCandidatureSubmitInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction?.guild?.channels) {
        return triggerErrorEmbed(
          new Error('Interaction, guild ou channels manquant'),
          {
            command: 'CandidatureSubmit',
            interaction,
          },
        );
      }

      const language =
        ['fr', 'en'].includes(interaction.customId.split('_')[2]) ?
          interaction.customId.split('_')[2]
        : 'fr';
      const channelName = `candidature-${interaction.user.username}`;
      const guild = interaction.guild;

      const category = interaction.channel?.parent;

      if (!category || category.type !== 4) {
        return safeReply(interaction, {
          content:
            interactionTexts[language]?.noCategory ||
            'Impossible de déterminer la catégorie du salon actuel.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const existingChannel = guild.channels.cache.find(
        (c) => c.name === channelName && c.parentId === category.id,
      );

      if (existingChannel) {
        return safeReply(interaction, {
          content:
            interactionTexts[language]?.alreadyExists ||
            'Vous avez déjà une candidature en cours.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await safeReply(interaction, {
        content:
          interactionTexts[language]?.creating ||
          'Création de votre candidature...',
        flags: MessageFlags.Ephemeral,
      });

      const modRoles = guild.roles.cache.filter(
        (r) =>
          !r.managed &&
          (r.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
            r.permissions.has(PermissionsBitField.Flags.KickMembers) ||
            r.permissions.has(PermissionsBitField.Flags.BanMembers) ||
            r.permissions.has(PermissionsBitField.Flags.Administrator)),
      );

      const permissionOverwrites = [
        {
          id: guild.id,
          type: 0,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: interaction.user.id,
          type: 1,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        ...modRoles.map((r) => ({
          id: r.id,
          type: 0,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages,
          ],
        })),
      ];

      const newChannel = await guild.channels.create({
        name: channelName,
        type: 0,
        parent: category.id,
        permissionOverwrites,
        topic:
          language === 'fr' ?
            `Candidature de <@${interaction.user.id}>.`
          : `Application of <@${interaction.user.id}>.`,
      });

      setTimeout(async () => {
        try {
          const modMentions = modRoles.map((r) => `<@&${r.id}>`).join(' ');
          const allowedMentions =
            guild.id === '1003624300575739974' ?
              {
                roles: [],
              }
            : {
                roles: modRoles.map((r) => r.id),
              };

          await newChannel.send({
            content: `${modMentions}\n${language === 'fr' ? 'Voici la candidature de' : 'Here is the application from'} <@${interaction.user.id}>:`,
            embeds: interaction.message.embeds,
            allowedMentions,
          });

          const pollEmbed =
            interactionTexts[language]?.candidatureSubmit?.pollEmbed;

          if (pollEmbed?.title && pollEmbed?.description) {
            const embedToSend = {
              color: embedColor,
              title: pollEmbed.title,
              description: pollEmbed.description,
              fields: pollEmbed.fields || [],
              footer: {
                text: (pollEmbed.footer || 'GLaDOS Bot').replace(
                  '{username}',
                  interaction.user.username,
                ),
              },
              timestamp: new Date(),
            };

            const pollButtons = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`poll_pour_${language}`)
                .setLabel(language === 'fr' ? 'Oui' : 'Yes')
                .setStyle(ButtonStyle.Success)
                .setEmoji({ id: '1304519561814741063' }),
              new ButtonBuilder()
                .setCustomId(`poll_contre_${language}`)
                .setLabel(language === 'fr' ? 'Non' : 'No')
                .setStyle(ButtonStyle.Danger)
                .setEmoji({ id: '1304519593083011093' }),
            );

            await newChannel.send({
              embeds: [embedToSend],
              components: [pollButtons],
            });
          }

          const managementButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`close_candid_${language}`)
              .setLabel(
                interactionTexts[language]?.candidatureSubmit?.closeButton ||
                  'Fermer',
              )
              .setStyle(ButtonStyle.Danger)
              .setEmoji({ id: '1304519593083011093' }),
          );

          await newChannel.send({
            embeds: [
              {
                color: embedColor,
                title:
                  interactionTexts[language]?.candidatureSubmit
                    ?.managementTitle || 'Gestion',
                description:
                  interactionTexts[language]?.candidatureSubmit
                    ?.managementDescription ||
                  'Gérez cette candidature avec les boutons ci-dessous.',
              },
            ],
            components: [managementButtons],
          });
        } catch (channelError) {
          return triggerErrorEmbed(
            channelError instanceof Error ? channelError : (
              new Error('Erreur configuration canal candidature')
            ),
            {
              command: 'CandidatureSubmit',
              interaction,
              error: channelError,
            },
          );
        }
      }, 500);
    },
    {
      command: 'CandidatureSubmit',
      interaction,
      fallbackError: async (error) => {
        if (error.code === 50013 || error.code === 50001) {
          const language = interaction?.customId?.split('_')?.[2] || 'fr';

          const permissionEmbed = {
            color: embedColor,
            title:
              language === 'fr' ?
                '⚠️ Permissions insuffisantes'
              : '⚠️ Insufficient permissions',
            description:
              language === 'fr' ?
                'Je ne peux pas créer le salon de candidature. Il me manque des permissions.'
              : 'I cannot create the application channel. I lack permissions.',
            fields: [
              {
                name:
                  language === 'fr' ?
                    '🔒 Permissions requises'
                  : '🔒 Required permissions',
                value:
                  language === 'fr' ?
                    '• `Gérer les salons` - Pour créer des salons\n• `Voir les salons` - Pour accéder aux salons'
                  : '• `Manage Channels` - To create channels\n• `View Channels` - To access channels',
                inline: false,
              },
            ],
            footer: {
              text: `Error code: ${error.code} | GLaDOS Bot`,
            },
            timestamp: new Date(),
          };

          return safeReply(interaction, {
            embeds: [permissionEmbed],
            flags: MessageFlags.Ephemeral,
          });
        }

        const fallbackMessage =
          interactionTexts[interaction?.customId?.split('_')?.[2] || 'fr']
            ?.genericError ||
          'Une erreur est survenue lors de la création de votre candidature.';

        return safeReply(interaction, {
          content: fallbackMessage,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  );
}

export { handleCandidatureSubmitInteraction };

