import { EmbedBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleVoiceAddUsers(interaction) {
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

    function extractOwnerIdFromEmbed(interaction) {
      const voiceControlMessage = interaction.channel.messages.cache.find(
        (msg) =>
          msg.author.bot &&
          msg.embeds.length > 0 &&
          msg.embeds[0].description &&
          (msg.embeds[0].description.includes('Oui, je parle de vous') ||
            msg.embeds[0].description.includes("Yes, I'm talking about you")),
      );

      if (!voiceControlMessage?.embeds?.[0]?.description) return null;

      const description = voiceControlMessage.embeds[0].description;

      const mentionMatch = description.match(/<@(\d{17,20})>/);
      return mentionMatch ? mentionMatch[1] : null;
    }

    const channelOwnerId = extractOwnerIdFromEmbed(interaction);
    const isOwner = channelOwnerId === interaction.user.id;
    const isModerator = interaction.member.permissions.has(
      PermissionsBitField.Flags.ModerateMembers,
    );
    if (!isModerator && !isOwner) {
      return interaction.reply({
        content:
          interactionTexts[language]?.customVoices?.noPermission ||
          (language === 'fr' ?
            `🤖 Oh regardez ça ! Un utilisateur qui pense pouvoir modifier mes protocoles vocaux. Comme c'est... mignon. Permissions insuffisantes.\n\n🔧 **Vous devez être le propriétaire du salon ou avoir des permissions de modération.**`
          : `🤖 Oh look at that! A user who thinks they can modify my voice protocols. How... cute. Insufficient permissions.\n\n🔧 **You must be the channel owner or have moderation permissions.**`),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (
      !interaction.channel.name.includes('Salon de') ||
      interaction.channel.type !== 2
    ) {
      return interaction.reply({
        content:
          language === 'fr' ?
            "⚠️ Cette fonction n'est disponible que dans les salons vocaux personnalisés. Vous n'êtes manifestement pas au bon endroit."
          : '⚠️ This function is only available in custom voice channels. You are clearly not in the right place.',
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
    const ownerId = channelOwnerId;

    for (const userId of selectedUserIds) {
      try {
        if (userId === ownerId) {
          errors.push(
            language === 'fr' ?
              `Le propriétaire du salon ne peut pas être retiré`
            : `The channel owner cannot be removed`,
          );
          continue;
        }

        const user = await interaction.guild.members
          .fetch(userId)
          .catch(() => null);
        if (!user) {
          errors.push(
            language === 'fr' ?
              `Utilisateur ${userId} non trouvé sur le serveur`
            : `User ${userId} not found on server`,
          );
          continue;
        }

        const currentPermissions = interaction.channel.permissionsFor(userId);
        const hasAccess = currentPermissions?.has(
          PermissionsBitField.Flags.Connect,
        );

        if (hasAccess) {
          await interaction.channel.permissionOverwrites.edit(
            userId,
            {
              Connect: false,
              ViewChannel: false,
            },
            { type: 1 },
          );
          removedUsers.push(user);
        } else {
          await interaction.channel.permissionOverwrites.edit(
            userId,
            {
              Connect: true,
              ViewChannel: true,
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
        errors.push(
          language === 'fr' ?
            `Erreur avec l'utilisateur ${userId}: ${error.message}`
          : `Error with user ${userId}: ${error.message}`,
        );
      }
    }

    let responseContent = '';

    if (addedUsers.length > 0) {
      const userMentions = addedUsers.map((user) => `<@${user.id}>`).join(', ');
      responseContent +=
        language === 'fr' ?
          `<:true:1304519561814741063> **Nouveaux utilisateurs ajoutés au salon vocal :**\n${userMentions} \n\nBienvenue dans ce salon vocal. Essayez de ne pas trop l'encombrer... enfin, pas plus que d'habitude.\n\n`
        : `<:true:1304519561814741063> **New users added to voice channel:**\n${userMentions} \n\nWelcome to this voice channel. Try not to clutter it too much... well, not more than usual.\n\n`;
    }

    if (removedUsers.length > 0) {
      const userMentions = removedUsers
        .map((user) => `<@${user.id}>`)
        .join(', ');
      responseContent +=
        language === 'fr' ?
          `<:false:1304519593083011093> **Utilisateurs retirés du salon vocal :**\n${userMentions} \n\nAu revoir ! Merci d'avoir participé à cette conversation vocale fascinante. Votre contribution ne sera pas oubliée... enfin, si.\n\n`
        : `<:false:1304519593083011093> **Users removed from voice channel:**\n${userMentions} \n\nGoodbye! Thank you for participating in this fascinating voice conversation. Your contribution will not be forgotten... well, actually it will.\n\n`;
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
            '🎤 Modification des utilisateurs du salon vocal'
          : '🎤 Voice channel users modification',
        );

      let description = '';

      if (addedUsers.length > 0) {
        const addedMentions = addedUsers
          .map((user) => `<@${user.id}>`)
          .join(', ');
        description +=
          language === 'fr' ?
            `🎤 **Nouveaux participants :** ${addedMentions}`
          : `🎤 **New participants:** ${addedMentions}`;
      }

      if (removedUsers.length > 0) {
        const removedMentions = removedUsers
          .map((user) => `<@${user.id}>`)
          .join(', ');
        if (description) description += '\n\n';
        description +=
          language === 'fr' ?
            `🔇 **Utilisateurs retirés :** ${removedMentions}`
          : `🔇 **Removed users:** ${removedMentions}`;
      }

      description +=
        language === 'fr' ?
          `\n\n*Protocole exécuté par <@${interaction.user.id}>*\n*"La communication vocale ne s'arrête jamais !"*`
        : `\n\n*Protocol executed by <@${interaction.user.id}>*\n*"Voice communication never stops!"*`;

      embed.setDescription(description);

      await interaction.channel.send({
        embeds: [embed],
      });
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
          `<:false:1304519593083011093> Erreur critique lors de la gestion des utilisateurs du salon vocal. Même mes protocoles de sécurité vocaux fonctionnent mieux que cette tentative.\n\n🔧 **Contactez un administrateur** si le problème persiste.`
        : `<:false:1304519593083011093> Critical error while managing voice channel users. Even my voice security protocols work better than this attempt.\n\n🔧 **Contact an administrator** if the problem persists.`;

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

export { handleVoiceAddUsers };

