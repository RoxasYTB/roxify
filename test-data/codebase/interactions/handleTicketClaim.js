import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
} from 'discord.js';

import { embedColor } from '../config/config.js';
import { encode } from '../utils/3y3.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

function getTicketInfo(topic) {
  if (!topic)
    return {
      askerId: null,
      claimerId: null,
    };

  const askerMatch = topic.match(/Ticket créé par <@(\d+)>/);
  const claimerMatch = topic.match(/et claim par <@(\d+)>/);

  return {
    askerId: askerMatch ? askerMatch[1] : null,
    claimerId: claimerMatch ? claimerMatch[1] : null,
  };
}

function createTicketTopic(askerId, claimerId = null) {
  let topic = `Ticket créé par <@${askerId}>`;
  if (claimerId) {
    topic += ` et claim par <@${claimerId}>`;
  }
  return topic;
}

async function handleTicketClaim(interaction) {
  try {
    if (
      !interaction ||
      !interaction.guild ||
      !interaction.member ||
      !interaction.channel
    ) {
      return;
    }

    if (interaction.createdTimestamp < Date.now() - 15 * 60 * 1000) {
      return;
    }

    if (interaction.replied || interaction.deferred) {
      return;
    }

    if (!interaction.isRepliable()) {
      return;
    }

    const language = interaction.customId.split('_').pop() || 'fr';

    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content:
          language === 'fr' ?
            "⚠️ Cette fonction n'est disponible que dans les tickets officiels. Vous n'êtes manifestement pas au bon endroit."
          : '⚠️ This function is only available in official tickets. You are clearly not in the right place.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const hasStaffPermissions =
      interaction.member.permissions.has(
        PermissionsBitField.Flags.ModerateMembers,
      ) ||
      interaction.member.permissions.has(
        PermissionsBitField.Flags.KickMembers,
      ) ||
      interaction.member.permissions.has(
        PermissionsBitField.Flags.BanMembers,
      ) ||
      interaction.member.permissions.has(
        PermissionsBitField.Flags.ManageMessages,
      );

    if (!hasStaffPermissions) {
      return interaction.reply({
        content:
          language === 'fr' ?
            "🤖 Oh regardez ça ! Un utilisateur qui pense pouvoir prendre en charge mes protocoles. Comme c'est... mignon. Permissions insuffisantes.\n\n🔧 **Contactez un administrateur** si le problème persiste."
          : '🤖 Oh look at that! A user who thinks they can handle my protocols. How... cute. Insufficient permissions.\n\n🔧 **Contact an administrator** if the problem persists.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const ticketInfo = getTicketInfo(interaction.channel.topic);

    if (ticketInfo.claimerId) {
      const claimedUser = await interaction.guild.members
        .fetch(ticketInfo.claimerId)
        .catch(() => null);
      const claimedUsername =
        claimedUser ? claimedUser.displayName : 'Utilisateur inconnu';

      return interaction.reply({
        content:
          language === 'fr' ?
            `<:false:1304519593083011093> **Ticket déjà pris en charge**\n\nCe ticket est déjà sous la supervision du staff **${claimedUsername}**. Un seul responsable par ticket, c'est déjà bien assez.`
          : `<:false:1304519593083011093> **Ticket already claimed**\n\nThis ticket is already under the supervision of staff **${claimedUsername}**. One supervisor per ticket is quite enough.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    let askerId = ticketInfo.askerId;
    if (!askerId) {
      const channelNameMatch = interaction.channel.name.match(/ticket-(\d+)/);
      askerId = channelNameMatch ? channelNameMatch[1] : null;
    }

    const newTopic = createTicketTopic(
      askerId || 'unknown',
      interaction.user.id,
    );

    try {
      await interaction.channel.setTopic(newTopic);
    } catch (topicError) {
      console.warn('Impossible de modifier le topic du channel:', topicError);
    }
    try {
      const managementRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_claim_${language}`)
          .setLabel(language === 'fr' ? 'Claim le ticket' : 'Claim the ticket')
          .setStyle(ButtonStyle.Success)
          .setEmoji({ id: '1304519561814741063' }),
        new ButtonBuilder()
          .setCustomId(`close_ticket_${language}`)
          .setLabel(language === 'fr' ? 'Fermer le ticket' : 'Close ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji({ id: '1304519593083011093' }),
        new ButtonBuilder()
          .setCustomId(`add_users_ticket_${language}`)
          .setLabel(
            language === 'fr' ? 'Ajouter des utilisateurs' : 'Add users',
          )
          .setStyle(ButtonStyle.Secondary)
          .setEmoji({ name: '👥' }),
      );

      if (
        interaction.replied ||
        interaction.deferred ||
        !interaction.isRepliable()
      ) {
        return;
      }

      await interaction.update({
        components: [managementRow],
      });
    } catch (updateError) {
      if (updateError.code === 10062) {
        return;
      }
      if (updateError.code === 50035) {
        return;
      }
    }
    const claimEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(
        language === 'fr' ? '🎫 Ticket pris en charge' : '🎫 Ticket claimed',
      )
      .setDescription(
        language === 'fr' ?
          `> Ce ticket est désormais sous la **supervision** de <@${interaction.user.id}>.\n> Excellent ! Un membre du staff qualifié pour mener cette résolution à bien.\n\n*Les autres membres du staff peuvent toujours consulter ce ticket, mais seul le responsable désigné peut le gérer.*`
        : `> This ticket is now under the **supervision** of <@${interaction.user.id}>.\n> Excellent! A qualified staff member to handle this resolution properly.\n\n*Other staff members can still view this ticket, but only the designated supervisor can manage it.*`,
      )
      .setTimestamp();

    await interaction.channel.send({
      embeds: [claimEmbed],
    });

    const logChannel = interaction.guild.channels.cache.find(
      (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_tickets')),
    );

    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(language === 'fr' ? '🎫 Ticket claimé' : '🎫 Ticket claimed')
        .setDescription(
          language === 'fr' ?
            'Un ticket a été pris en charge par un membre du personnel.'
          : 'A ticket has been claimed by a staff member.',
        )
        .addFields(
          {
            name: language === 'fr' ? 'Ticket concerné' : 'Related ticket',
            value: `<#${interaction.channel.id}>`,
            inline: true,
          },
          {
            name: language === 'fr' ? 'Créé par' : 'Created by',
            value: askerId ? `<@${askerId}>` : 'Inconnu',
            inline: true,
          },
          {
            name: language === 'fr' ? 'Pris en charge par' : 'Claimed by',
            value: `<@${interaction.user.id}>`,
            inline: true,
          },
          {
            name: language === 'fr' ? 'Date du claim' : 'Claim date',
            value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
            inline: true,
          },
        )
        .setTimestamp();

      try {
        await logChannel.send({
          embeds: [logEmbed],
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
    if (error.code === 10062) {
      return;
    }
    if (error.code === 50035) {
      return;
    }

    triggerErrorEmbed(
      error,
      interaction.client?.user?.username,
      interaction.client?.user?.displayAvatarURL(),
    );

    const language = interaction?.customId?.split('_')?.pop() || 'fr';
    const errorMessage =
      language === 'fr' ?
        '<:false:1304519593083011093> Erreur critique lors de la prise en charge du ticket. Même mes protocoles de sécurité fonctionnent mieux que cette tentative.\n\n🔧 **Contactez un administrateur** si le problème persiste.'
      : '<:false:1304519593083011093> Critical error while claiming the ticket. Even my security protocols work better than this attempt.\n\n🔧 **Contact an administrator** if the problem persists.';

    if (
      !interaction.replied &&
      !interaction.deferred &&
      interaction.isRepliable()
    ) {
      await interaction.reply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export { handleTicketClaim };

