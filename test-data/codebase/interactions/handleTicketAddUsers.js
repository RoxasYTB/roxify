import { EmbedBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import config, { embedColor } from '../config/config.js';
import { encode } from '../utils/3y3.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleTicketAddUsers(interaction) {
  try {
    if (
      !interaction ||
      !interaction.guild ||
      !interaction.member ||
      !interaction.channel
    ) {
      return;
    }

    const language = interaction.customId.split('_').pop() || 'fr';

    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.ModerateMembers,
      )
    ) {
      return interaction.reply({
        content:
          language === 'fr' ?
            `🤖 Oh regardez ça ! Un utilisateur qui pense pouvoir modifier mes protocoles. Comme c'est... mignon. Permissions insuffisantes.\n\n🔧 **Contactez un administrateur** si le problème persiste :\n📞 ${config.aiLinks.supportLink}`
          : `🤖 Oh look at that! A user who thinks they can modify my protocols. How... cute. Insufficient permissions.\n\n🔧 **Contact an administrator** if the problem persists:\n📞 ${config.aiLinks.supportLink}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({
        content:
          language === 'fr' ?
            "⚠️ Cette fonction n'est disponible que dans les tickets officiels. Vous n'êtes manifestement pas au bon endroit."
          : '⚠️ This function is only available in official tickets. You are clearly not in the right place.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (
      !interaction.values ||
      !Array.isArray(interaction.values) ||
      interaction.values.length === 0
    ) {
      return interaction.reply({
        content:
          language === 'fr' ?
            '<:false:1304519593083011093> Aucun utilisateur sélectionné.'
          : '<:false:1304519593083011093> No users selected.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const selectedUserIds = interaction.values;
    const addedUsers = [];
    const removedUsers = [];
    const errors = [];

    for (const userId of selectedUserIds) {
      try {
        const user = await interaction.guild.members
          .fetch(userId)
          .catch(() => null);
        if (!user) {
          errors.push(`Utilisateur ${userId} non trouvé sur le serveur`);
          continue;
        }

        const currentPermissions = interaction.channel.permissionsFor(userId);
        const hasAccess = currentPermissions?.has(
          PermissionsBitField.Flags.ViewChannel,
        );

        if (hasAccess) {
          await interaction.channel.permissionOverwrites.edit(
            userId,
            {
              ViewChannel: false,
              SendMessages: false,
              ReadMessageHistory: false,
            },
            { type: 1 },
          );
          removedUsers.push(user);
        } else {
          await interaction.channel.permissionOverwrites.edit(
            userId,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            },
            { type: 1 },
          );
          addedUsers.push(user);
        }
      } catch (error) {
        triggerErrorEmbed(
          error,
          interaction.client?.user?.username,
          interaction.client?.user?.displayAvatarURL(),
        );
        errors.push(`Erreur avec l'utilisateur ${userId}: ${error.message}`);
      }
    }

    let responseContent = '';

    if (addedUsers.length > 0) {
      const userMentions = addedUsers.map((user) => `<@${user.id}>`).join(', ');
      responseContent +=
        language === 'fr' ?
          `<:true:1304519561814741063> **Nouveaux utilisateurs ajoutés au ticket :**\n${userMentions} \n\nBienvenue dans ce ticket. Essayez de ne pas trop l'encombrer... enfin, pas plus que d'habitude.\n\n`
        : `<:true:1304519561814741063> **New users added to ticket:**\n${userMentions} \n\nWelcome to this ticket. Try not to clutter it too much... well, not more than usual.\n\n`;
    }

    if (removedUsers.length > 0) {
      const userMentions = removedUsers
        .map((user) => `<@${user.id}>`)
        .join(', ');
      responseContent +=
        language === 'fr' ?
          `<:false:1304519593083011093> **Utilisateurs retirés du ticket :**\n${userMentions} \n\nAu revoir ! Merci d'avoir participé à cette discussion fascinante. Votre contribution ne sera pas oubliée... enfin, si.\n\n`
        : `<:false:1304519593083011093> **Users removed from ticket:**\n${userMentions} \n\nGoodbye! Thank you for participating in this fascinating discussion. Your contribution will not be forgotten... well, actually it will.\n\n`;
    }

    if (errors.length > 0) {
      responseContent +=
        language === 'fr' ?
          `⚠️ **Dysfonctionnements détectés :**\n${errors.join('\n')} \n\nCertains utilisateurs semblent défaillants. Comme d'habitude.`
        : `⚠️ **Malfunctions detected:**\n${errors.join('\n')} \n\nSome users appear to be defective. As usual.`;
    }

    if (
      addedUsers.length === 0 &&
      removedUsers.length === 0 &&
      errors.length === 0
    ) {
      responseContent =
        language === 'fr' ?
          '<:false:1304519593083011093> Aucune modification effectuée. Même mes systèmes les plus basiques fonctionnent mieux que vous.'
        : '<:false:1304519593083011093> No changes made. Even my most basic systems work better than you do.';
    }

    await interaction.update({
      content: responseContent,
      embeds: [],
      components: [],
    });

    if (addedUsers.length > 0 || removedUsers.length > 0) {
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(
          language === 'fr' ?
            '🧪 Modification des utilisateurs du ticket'
          : '🧪 Ticket users modification',
        );
      let description = '';

      if (addedUsers.length > 0) {
        const addedMentions = addedUsers
          .map((user) => `<@${user.id}>`)
          .join(', ');
        description +=
          language === 'fr' ?
            `🧪 **Nouveaux participants :** ${addedMentions}`
          : `🧪 **New participants:** ${addedMentions}`;
      }

      if (removedUsers.length > 0) {
        const removedMentions = removedUsers
          .map((user) => `<@${user.id}>`)
          .join(', ');
        if (description) description += '\n\n';
        description +=
          language === 'fr' ?
            `🗑️ **Utilisateurs retirés :** ${removedMentions}`
          : `🗑️ **Removed users:** ${removedMentions}`;
      }

      description +=
        language === 'fr' ?
          `\n\n*Protocole exécuté par <@${interaction.user.id}>*\n*"Le support Discord ne s'arrête jamais !"*`
        : `\n\n*Protocol executed by <@${interaction.user.id}>*\n*"Discord support never stops!"*`;

      embed.setDescription(description);

      await interaction.channel.send({
        embeds: [embed],
      });
    }

    const logChannel = interaction.guild.channels.cache.find(
      (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_tickets')),
    );

    if (logChannel && (addedUsers.length > 0 || removedUsers.length > 0)) {
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(
          language === 'fr' ?
            '📊 Rapport de modification des utilisateurs'
          : '📊 User modification report',
        )
        .addFields(
          {
            name: language === 'fr' ? 'Ticket concerné' : 'Related ticket',
            value: `<#${interaction.channel.id}>`,
            inline: true,
          },
          {
            name:
              language === 'fr' ?
                'Responsable du protocole'
              : 'Protocol supervisor',
            value: `<@${interaction.user.id}>`,
            inline: true,
          },
        )

        .setFooter({
          text: 'Données archivées par GLaDOS - Division Support Discord',
        });

      if (addedUsers.length > 0) {
        embed.addFields({
          name:
            language === 'fr' ? 'Nouveaux participants' : 'New participants',
          value: addedUsers.map((user) => `<@${user.id}>`).join('\n'),
          inline: false,
        });
      }

      if (removedUsers.length > 0) {
        embed.addFields({
          name: language === 'fr' ? 'Utilisateurs retirés' : 'Removed users',
          value: removedUsers.map((user) => `<@${user.id}>`).join('\n'),
          inline: false,
        });
      }

      try {
        await logChannel.send({
          embeds: [embed],
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
          `<:false:1304519593083011093> Erreur critique lors de la gestion des utilisateurs. Même mes protocoles de sécurité fonctionnent mieux que cette tentative.\n\n🔧 **Contactez un administrateur** ou le support du bot si le problème persiste :\n📞 ${config.aiLinks.supportLink}`
        : `<:false:1304519593083011093> Critical error while managing users. Even my security protocols work better than this attempt.\n\n🔧 **Contact an administrator** or bot support if the problem persists:\n📞 ${config.aiLinks.supportLink}`;

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

export { handleTicketAddUsers };

