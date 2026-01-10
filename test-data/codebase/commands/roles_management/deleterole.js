import { PermissionsBitField } from 'discord.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function deleterole(message, roleId) {
  try {
    if (!roleId || typeof roleId !== 'string' || !/^\d{17,19}$/.test(roleId)) {
      if (message.channel) {
        await message.channel.send(
          'ID de rôle invalide. Veuillez fournir un ID de rôle valide.',
        );
      }
      return;
    }

    const r = message.guild.roles.cache.get(roleId);
    if (!r) {
      if (message.channel) {
        await message.channel.send(
          "Ce rôle n'existe pas ou n'a pas pu être trouvé sur ce serveur.",
        );
      }
      return;
    }

    const botMember = message.guild.members.me;
    if (
      !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
      r.position >= botMember.roles.highest.position
    ) {
      if (message.channel) {
        await message.channel.send(
          "Je n'ai pas la permission ou la hiérarchie suffisante pour supprimer ce rôle.",
        );
      }
      return;
    }

    await r.delete();

    if (message.channel) {
      await message.channel.send(
        `Le rôle "${r.name}" a été supprimé avec succès.`,
      );
    }
  } catch (error) {
    if (error.code === 50028) {
      if (message.channel) {
        try {
          await message.channel.send(
            "Ce rôle n'existe pas ou a déjà été supprimé.",
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
      return;
    }

    if (error.code === 40333) {
      if (message.channel) {
        await message.channel.send(
          "Je ne peux pas supprimer ce rôle à cause de la hiérarchie des rôles ou d'une restriction Discord (code 40333). Vérifiez que mon rôle est bien au-dessus de la cible et que j'ai les permissions nécessaires.",
        );
      }
      return;
    }

    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );

    if (message.channel) {
      try {
        await message.channel.send(
          'Une erreur est survenue lors de la suppression du rôle.',
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

export { deleterole };

