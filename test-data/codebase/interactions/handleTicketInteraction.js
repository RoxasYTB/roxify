import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';

import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { t } from '../locales/index.js';
import { encode } from '../utils/3y3.js';
import { safeExecute } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleTicketInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction.isButton() && !interaction.isModalSubmit()) return;

      if (
        interaction.createdTimestamp < Date.now() - 15 * 60 * 1000 ||
        interaction.replied ||
        interaction.deferred ||
        !interaction.isRepliable()
      ) {
        return;
      }

      const language = interaction.customId.split('_').pop()?.trim() || 'fr';
      const sanitizedUsername = interaction.user.username
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
      const ticketChannelName = `ticket-${sanitizedUsername}`;

      const getModerationRoles = async () =>
        (await interaction.guild.roles.fetch()).filter(
          (r) =>
            r.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
            r.permissions.has(PermissionsBitField.Flags.KickMembers) ||
            r.permissions.has(PermissionsBitField.Flags.BanMembers),
        );

      const sendLog = async (action, language, channel = null) => {
        const logChannel = interaction.guild.channels.cache.find(
          (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_tickets')),
        );
        if (logChannel) {
          const title =
            language === 'fr' ?
              `🎫 Gestion des tickets - ${action}`
            : `🎫 Ticket Management - ${action}`;

          const description =
            language === 'fr' ?
              `Un ticket a été ${action}. Encore du travail pour moi... quelle surprise.`
            : `A ticket has been ${action}. More work for me... what a surprise.`;

          const actionByLabel =
            language === 'fr' ? `${action} par :` : `${action} by:`;

          const footerText =
            language === 'fr' ?
              'Système de tickets GLaDOS - Pour la science... et votre santé mentale'
            : 'GLaDOS Ticket System - For science... and your mental health';

          await logChannel.send({
            embeds: [
              {
                color: embedColor,
                title: title,
                description: description,
                fields: [
                  {
                    name:
                      language === 'fr' ? 'Ticket concerné' : 'Related ticket',
                    value:
                      channel ?
                        `<#${channel.id}>`
                      : `<#${interaction.channel.id}>`,
                    inline: true,
                  },
                  {
                    name: actionByLabel,
                    value: `<@${interaction.user.id}>`,
                    inline: true,
                  },
                ],
                timestamp: new Date(),
                footer: {
                  text: footerText,
                },
              },
            ],
          });
        }
      };

      if (
        interaction.isButton() &&
        interaction.customId.includes('open_ticket')
      ) {
        const modal = new ModalBuilder()
          .setCustomId(`open_ticket_reason_${language}`)
          .setTitle(language === 'fr' ? 'Raison du ticket' : 'Ticket reason');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel(
            language === 'fr' ? 'Expliquez la raison' : 'Describe the reason',
          )
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(5)
          .setMaxLength(500)
          .setRequired(true)
          .setPlaceholder(
            language === 'fr' ?
              "Ex: Problème de rôle, demande d'aide, signalement, etc."
            : 'E.g., role issue, need help, report, etc.',
          );

        const modalRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(modalRow);

        await interaction.showModal(modal);
        return;
      } else if (
        interaction.isModalSubmit() &&
        interaction.customId.includes('open_ticket_reason_')
      ) {
        const reasonRaw = interaction.fields.getTextInputValue('reason') || '';
        const reason = reasonRaw.trim().slice(0, 500);

        const existingTicket = interaction.guild.channels.cache.find(
          (channel) =>
            channel.name === ticketChannelName ||
            (channel.topic &&
              channel.topic.includes(`<@${interaction.user.id}>`)),
        );

        if (existingTicket) {
          return interaction.reply({
            content: interactionTexts[language]?.ticket?.alreadyOpen,
            flags: MessageFlags.Ephemeral,
          });
        }

        const category = interaction.channel.parent;

        if (!category) {
          return interaction.reply({
            content: t('tickets.categoryError', language),
            flags: MessageFlags.Ephemeral,
          });
        }

        const permissionOverwrites = [
          {
            id: interaction.guild.id,
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
        ];
        try {
          await interaction.reply({
            content:
              language === 'fr' ?
                '🎫 Création du ticket en cours...'
              : '🎫 Creating ticket...',
            flags: MessageFlags.Ephemeral,
          });

          const ticketChannel = await interaction.guild.channels.create({
            name: ticketChannelName,
            type: 0,
            parent: category.id,
            permissionOverwrites,
            topic: `Ticket créé par <@${interaction.user.id}> | ${
              language === 'fr' ? 'Raison' : 'Reason'
            }: ${reason}`.slice(0, 1024),
          });

          const imageAttachment = {
            attachment: `http://localhost:9871/captcha-reverse/Tickets`,
            name: 'captcha.webp',
          };

          try {
            await ticketChannel.send({
              embeds: [
                {
                  title: t('tickets.title', language),
                  description: t('tickets.description', language, {
                    userId: interaction.user.id,
                  }),
                  color: 16776960,
                  fields: [
                    {
                      name: language === 'fr' ? 'Raison' : 'Reason',
                      value:
                        '```' + reason + '```' ||
                        (language === 'fr' ? 'Non précisée' : 'Not specified'),
                    },
                  ],
                  image: {
                    url: 'attachment://captcha.webp',
                  },
                },
              ],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(`ticket_claim_${language}`)
                    .setLabel(
                      language === 'fr' ? 'Claim le ticket' : 'Claim ticket',
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
                      language === 'fr' ?
                        'Ajouter des utilisateurs'
                      : 'Add users',
                    )
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji({ name: '👥' }),
                ),
              ],
              files: [imageAttachment],
            });
          } catch (embedError) {
            console.warn(
              "Erreur lors de l'envoi de l'embed avec image:",
              embedError,
            );
            await ticketChannel.send({
              embeds: [
                {
                  title: t('tickets.title', language),
                  description: t('tickets.description', language, {
                    userId: interaction.user.id,
                  }),
                  color: 16776960,
                  fields: [
                    {
                      name: language === 'fr' ? 'Raison' : 'Reason',
                      value:
                        '```' + reason + '```' ||
                        (language === 'fr' ? 'Non précisée' : 'Not specified'),
                    },
                  ],
                },
              ],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(`ticket_claim_${language}`)
                    .setLabel(
                      language === 'fr' ? 'Claim le ticket' : 'Claim ticket',
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
                      language === 'fr' ?
                        'Ajouter des utilisateurs'
                      : 'Add users',
                    )
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji({ name: '👥' }),
                ),
              ],
            });
          }

          await interaction.editReply({
            content:
              language === 'fr' ?
                `🎫 Parfait ! Votre ticket a été créé dans ${ticketChannel}. Un staff viendra s'occuper de votre cas... quand il aura le temps.`
              : `🎫 Perfect! Your ticket has been created in ${ticketChannel}. A staff member will handle your case... when they have time.`,
          });

          await sendLog(
            language === 'fr' ? 'ouvert' : 'opened',
            language,
            ticketChannel,
          );
        } catch (createError) {
          console.error('Erreur lors de la création du ticket:', createError);

          if (createError.code === 10062) {
            return;
          }
          if (
            createError.code === 50035 &&
            createError.message.includes('CHANNEL_PARENT_MAX_CHANNELS')
          ) {
            if (
              !interaction.replied &&
              !interaction.deferred &&
              interaction.isRepliable()
            ) {
              return interaction.reply({
                content: interactionTexts[language]?.ticket?.categoryFull,
                flags: MessageFlags.Ephemeral,
              });
            }
            return;
          }

          if (
            !interaction.replied &&
            !interaction.deferred &&
            interaction.isRepliable()
          ) {
            return interaction.reply({
              content:
                language === 'fr' ?
                  `🤖 Erreur lors de la création du ticket. ${createError.message}. Contactez un administrateur si le problème persiste.`
                : `🤖 Error creating ticket. ${createError.message}. Contact an administrator if the problem persists.`,
              flags: MessageFlags.Ephemeral,
            });
          } else if (interaction.replied) {
            try {
              await interaction.editReply({
                content:
                  language === 'fr' ?
                    `🤖 Erreur lors de la création du ticket. ${createError.message}. Contactez un administrateur si le problème persiste.`
                  : `🤖 Error creating ticket. ${createError.message}. Contact an administrator if the problem persists.`,
              });
            } catch (editError) {
              console.error(
                'Erreur lors de la modification de la réponse:',
                editError,
              );
            }
          }

          triggerErrorEmbed(createError, {
            action: 'handleTicketInteraction',
            step: 'ticket_creation',
            userId: interaction.user.id,
            guildId: interaction.guild.id,
          });
        }
      } else if (interaction.customId.includes('delete_ticket')) {
        if (
          interaction.replied ||
          interaction.deferred ||
          !interaction.isRepliable()
        )
          return;
        await interaction.reply({
          content: interactionTexts[language]?.ticket?.deletionSoon,
          ephemeral: false,
        });

        setTimeout(
          () =>
            interaction.channel.delete().catch((error) => {
              triggerErrorEmbed(
                error,
                interaction.client?.user?.username,
                interaction.client?.user?.displayAvatarURL(),
              );
            }),
          5000,
        );
      } else if (interaction.customId.includes('close_ticket')) {
        if (
          interaction.replied ||
          interaction.deferred ||
          !interaction.isRepliable()
        )
          return;

        await interaction.update({
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`openagain_ticket_${language}`)
                .setLabel(t('tickets.buttons.reopen', language))
                .setStyle(ButtonStyle.Success)
                .setEmoji({ id: '1304519561814741063' }),

              new ButtonBuilder()
                .setCustomId(`delete_ticket_${language}`)
                .setLabel(t('tickets.buttons.delete', language))
                .setStyle(ButtonStyle.Danger)
                .setEmoji({ id: '1304519593083011093' })
                .setDisabled(true),

              new ButtonBuilder()
                .setCustomId(`transcript_ticket_${language}`)
                .setLabel(t('tickets.buttons.transcript', language))
                .setStyle(ButtonStyle.Secondary)
                .setEmoji({ id: '1269193830524125277' }),
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

        await interaction.channel.send({
          embeds: [
            {
              title: language === 'fr' ? '🔒 Ticket fermé' : '🔒 Ticket closed',
              description:
                language === 'fr' ?
                  `> Ce ticket a été **fermé** par <@${interaction.user.id}>.\n> Vous pouvez le **réouvrir** ou le **supprimer** si nécessaire. C'est votre choix... enfin, presque.`
                : `> This ticket has been **closed** by <@${interaction.user.id}>.\n> You can **reopen** it or **delete** it if necessary. It's your choice... well, almost.`,
              color: embedColor,
              timestamp: new Date(),
            },
          ],
        });
        await sendLog(language === 'fr' ? 'fermé' : 'closed', language);
      } else if (interaction.customId.includes('add_users_ticket')) {
        if (
          !interaction.member.permissions.has(
            PermissionsBitField.Flags.ModerateMembers,
          )
        ) {
          return interaction.reply({
            content: interactionTexts[language]?.ticket?.noPermission,
            flags: MessageFlags.Ephemeral,
          });
        }

        const userSelect = new UserSelectMenuBuilder()
          .setCustomId(`ticket_add_users_${language}`)
          .setPlaceholder(
            language === 'fr' ?
              'Sélectionnez les utilisateurs à ajouter...'
            : 'Select users to add...',
          )
          .setMinValues(1)
          .setMaxValues(10);

        const row = new ActionRowBuilder().addComponents(userSelect);

        const embed = new EmbedBuilder()
          .setTitle(
            language === 'fr' ?
              '🎫 Gestion des utilisateurs du ticket'
            : '🎫 Ticket user management',
          )
          .setDescription(
            language === 'fr' ?
              'Sélectionnez les membres à ajouter ou retirer de ce ticket :\n\n' +
                '• **Membres absents** → Seront **ajoutés** au ticket\n' +
                '• **Membres présents** → Seront **retirés** du ticket\n\n' +
                'Choisissez vos participants avec soin. Pour la science... et pour la résolution de ce ticket.'
            : 'Select the members you want to add or remove from this ticket:\n\n' +
                '• **Absent members** → Will be **added** to the ticket\n' +
                '• **Present members** → Will be **removed** from the ticket\n\n' +
                'Choose your participants carefully. For science... and for resolving this ticket.',
          )
          .setColor(embedColor);

        if (
          interaction.replied ||
          interaction.deferred ||
          !interaction.isRepliable()
        )
          return;

        await interaction.reply({
          embeds: [embed],
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.customId.includes('openagain_ticket')) {
        if (
          interaction.replied ||
          interaction.deferred ||
          !interaction.isRepliable()
        )
          return;

        await interaction.update({
          components: [
            new ActionRowBuilder().addComponents(
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
              new ButtonBuilder()
                .setCustomId(`ticket_claim_${language}`)
                .setLabel(
                  language === 'fr' ? 'Claim le ticket' : 'Claim ticket',
                )
                .setStyle(ButtonStyle.Success)
                .setEmoji({ id: '1304519561814741063' }),
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

            const originalUser = await interaction.guild.members
              .fetch(originalUserId)
              .catch(() => null);
            if (originalUser) {
              await interaction.channel.permissionOverwrites.create(
                originalUserId,
                {
                  ViewChannel: true,
                  SendMessages: true,
                  ReadMessageHistory: true,
                },
              );
            }
          }
        }

        await interaction.channel.send({
          embeds: [
            {
              title:
                language === 'fr' ? '🔓 Ticket réouvert' : '🔓 Ticket reopened',
              description:
                language === 'fr' ?
                  `> Ce ticket a été **réouvert** par <@${interaction.user.id}>.\n> Le support peut **reprendre**. J'espère que vous êtes prêts pour la suite.`
                : `> This ticket has been **reopened** by <@${interaction.user.id}>.\n> Support can **resume**. I hope you are ready for what follows.`,
              color: embedColor,
              timestamp: new Date(),
            },
          ],
        });
        await sendLog(language === 'fr' ? 'réouvert' : 'reopened', language);
      }
    },
    {
      interaction,
      command: 'TicketInteraction',
    },
  );
}

export { handleTicketInteraction };

