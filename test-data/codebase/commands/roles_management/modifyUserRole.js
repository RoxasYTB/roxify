import { MessageFlags, PermissionsBitField } from 'discord.js';
import { messageNoPerms } from '../../utils/response.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';
import WhiteList from '../../whitelist.json' with { type: 'json' };

async function modifyUserRole(
  message,
  userId,
  roleId,
  action,
  translateInto = 'fr',
) {
  try {
    const member = await message.guild.members.fetch(userId);
    const role = message.guild.roles.cache.get(roleId);
    const botMember = await message.guild.members.fetchMe();
    const moderator = await message.guild.members.fetch(message.author.id);

    if (!role) {
      return {
        error: 'role_not_found',
      };
    }

    const moderatorHighestRole =
      moderator ?
        moderator.roles.cache.sort((a, b) => b.position - a.position).first() ||
        null
      : null;

    if (
      (role.position > moderatorHighestRole.position ||
        !moderatorHighestRole) &&
      !WhiteList.OwnerByPass.includes(message.author.id) &&
      message.author.id != message.guild?.ownerId
    ) {
      const randomNoPermMessage =
        messageNoPerms[translateInto][
          Math.floor(Math.random() * messageNoPerms[translateInto].length)
        ];
      return message.reply({
        content: randomNoPermMessage,
        flags: MessageFlags.Ephemeral,
      });
    }

    const serverPermissions = botMember.permissions;
    const channelPermissions = message.channel.permissionsFor(botMember);

    const hasManageRoles =
      serverPermissions.has(PermissionsBitField.Flags.ManageRoles) ||
      serverPermissions.has(PermissionsBitField.Flags.Administrator);
    const hasChannelPermissions =
      channelPermissions.has(PermissionsBitField.Flags.ManageRoles) ||
      channelPermissions.has(PermissionsBitField.Flags.Administrator);

    if (!hasManageRoles || !hasChannelPermissions) {
      return {
        error: 'missing_permissions',
        detail: 'manage_roles',
        message:
          "Je n'ai pas la permission 'Gérer les rôles' sur ce serveur ou dans ce canal.",
        solution:
          "➤ **Solution :** Allez dans Paramètres du serveur > Rôles > Mon rôle > Activez 'Gérer les rôles' ET vérifiez les permissions du canal",
      };
    }

    const botHighestRole = botMember.roles.highest;
    if (role.position >= botHighestRole.position) {
      return {
        error: 'role_hierarchy',
        detail: 'role_too_high',
        message: `Le rôle <@&${role.id}> est plus haut ou égal à mon rôle le plus élevé <@&${botHighestRole.id}> dans la hiérarchie.`,
        solution: `➤ **Solution :** Glissez mon rôle <@&${botHighestRole.id}> AU-DESSUS du rôle <@&${role.id}> dans Paramètres du serveur > Rôles`,
      };
    }

    if (member.roles.highest.position >= botHighestRole.position) {
      return {
        error: 'member_hierarchy',
        detail: 'member_too_high',
        message: `Je ne peux pas modifier les rôles de <@${member.id}> car cette personne possède un rôle plus haut ou égal à mon rôle le plus élevé <@&${botHighestRole.id}> dans la hiérarchie.`,
        solution: `➤ **Solution :** Glissez mon rôle <@&${botHighestRole.id}> AU-DESSUS du rôle de <@${member.id}> dans la liste des rôles du serveur.`,
      };
    }

    if (role.managed) {
      return {
        error: 'role_managed',
        detail: 'integrated_role',
        message: `Le rôle <@&${role.id}> est un rôle intégré (bot/boost) et ne peut pas être modifié.`,
        solution:
          '➤ **Solution :** Les rôles de bots et de boost ne peuvent pas être gérés manuellement',
      };
    }

    if (action === 'add') {
      if (member.roles.cache.has(roleId)) {
        return {
          error: 'already_has_role',
          detail: 'user_already_has_role',
          message: `L'utilisateur possède déjà le rôle <@&${role.id}>.`,
        };
      }
      await member.roles.add(role);
    } else if (action === 'remove') {
      if (!member.roles.cache.has(roleId)) {
        return {
          error: 'doesnt_have_role',
          detail: 'user_doesnt_have_role',
          message: `L'utilisateur ne possède pas le rôle <@&${role.id}>.`,
        };
      }
      await member.roles.remove(role);
    }

    return {
      success: true,
    };
  } catch (error) {
    if (error.code === 50013) {
      const botMember = await message.guild.members.fetchMe();
      const role = message.guild.roles.cache.get(roleId);

      if (
        !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) &&
        !botMember.permissions.has(PermissionsBitField.Flags.Administrator)
      ) {
        return {
          error: 'missing_permissions',
          detail: 'no_manage_roles_permission',
          message:
            "Je n'ai pas la permission 'Gérer les rôles' sur ce serveur.",
          solution:
            "➤ **Solution :** Paramètres du serveur > Rôles > Mon rôle > Cochez 'Gérer les rôles'",
        };
      }

      if (role && role.position >= botMember.roles.highest.position) {
        return {
          error: 'missing_permissions',
          detail: 'role_hierarchy_issue',
          message: `Je ne peux pas modifier le rôle <@&${role.id}> car il est plus haut que mon rôle le plus élevé dans la hiérarchie.`,
          solution: `➤ **Solution :** Glissez mon rôle AU-DESSUS du rôle <@&${role.id}> dans la liste des rôles`,
        };
      }

      return {
        error: 'missing_permissions',
        detail: 'unknown_permission_issue',
        message: "Je n'ai pas les permissions nécessaires pour cette action.",
        solution:
          "➤ **Solution :** Vérifiez que j'ai la permission 'Gérer les rôles' et que mon rôle est assez haut dans la hiérarchie",
      };
    } else if (error.code === 50025) {
      return {
        error: 'invalid_token',
        detail: 'oauth_token_issue',
        message: "Problème d'authentification avec Discord.",
        solution:
          '➤ **Solution :** Contactez un développeur, problème technique',
      };
    } else if (error.code === 10007) {
      return {
        error: 'member_not_found',
        detail: 'user_not_in_guild',
        message: "L'utilisateur spécifié n'est pas membre de ce serveur.",
        solution:
          "➤ **Solution :** Vérifiez que l'utilisateur est bien sur le serveur",
      };
    } else if (error.code === 10011) {
      return {
        error: 'role_not_found',
        detail: 'role_deleted_or_invalid',
        message: "Le rôle spécifié n'existe plus ou l'ID est invalide.",
        solution:
          '➤ **Solution :** Vérifiez que le rôle existe encore sur le serveur',
      };
    } else if (error.code === 50034) {
      return {
        error: 'hierarchy_error',
        detail: 'role_position_conflict',
        message: 'Conflit de hiérarchie des rôles.',
        solution:
          '➤ **Solution :** Réorganisez la hiérarchie des rôles dans les paramètres',
      };
    }

    triggerErrorEmbed(error, {
      action: 'modifyUserRole',
      step: 'unexpected_error',
      component: 'modifyUserRole',
    });
    return {
      error: 'unknown_error',
      detail: 'unexpected_discord_error',
      message: `Erreur inattendue: ${error.message}`,
      solution:
        '➤ **Solution :** Contactez un administrateur, erreur technique inattendue',
      originalError: error,
    };
  }
}

export { modifyUserRole };

