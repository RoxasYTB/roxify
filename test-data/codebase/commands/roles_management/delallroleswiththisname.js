import { PermissionsBitField } from 'discord.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function delallroleswiththisname(message, roleName) {
  try {
    if (!roleName || roleName.trim() === '') {
      if (message.channel) {
        await message.channel.send(
          'Nom de rôle invalide. Veuillez fournir un nom de rôle valide.',
        );
      }
      return;
    }

    const matchingRoles = message.guild.roles.cache.filter(
      (role) =>
        role.name.toLowerCase().includes(roleName.toLowerCase()) &&
        role.name !== '@everyone',
    );

    if (matchingRoles.size === 0) {
      if (message.channel) {
        await message.channel.send(
          `Aucun rôle trouvé contenant "${roleName}" dans le nom.`,
        );
      }
      return;
    }

    const botMember = message.guild.members.me;
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      if (message.channel) {
        await message.channel.send(
          "Je n'ai pas la permission de gérer les rôles sur ce serveur.",
        );
      }
      return;
    }

    let deletedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const role of matchingRoles.values()) {
      if (role.position >= botMember.roles.highest.position) {
        skippedCount++;
        continue;
      }

      if (role.managed) {
        skippedCount++;
        continue;
      }

      try {
        await role.delete(
          `Suppression en masse via commande delallroleswiththisname par ${message.author.tag}`,
        );
        deletedCount++;
      } catch (error) {
        if (error.code === 50028) {
          continue;
        }
        if (error.code === 40333) {
          skippedCount++;
          continue;
        }
        errors.push(`${role.name}: ${error.message}`);
      }
    }

    let resultMessage = `Suppression terminée :\n`;
    resultMessage += `• ${deletedCount} rôle(s) supprimé(s)\n`;

    if (skippedCount > 0) {
      resultMessage += `• ${skippedCount} rôle(s) ignoré(s) (hiérarchie/protection)\n`;
    }

    if (errors.length > 0) {
      resultMessage += `• ${errors.length} erreur(s) rencontrée(s)\n`;
      if (errors.length <= 3) {
        resultMessage += `Erreurs : ${errors.join(', ')}`;
      } else {
        resultMessage += `Erreurs (premières) : ${errors.slice(0, 3).join(', ')}...`;
      }
    }

    if (message.channel && !message.channel.deleted) {
      await message.channel.send(resultMessage);
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );

    if (message.channel && !message.channel.deleted) {
      try {
        await message.channel.send(
          'Une erreur est survenue lors de la suppression des rôles.',
        );
      } catch (sendError) {
        if (![10008, 50013].includes(sendError.code)) {
          triggerErrorEmbed(
            sendError,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
      }
    }
  }
}

export { delallroleswiththisname };

