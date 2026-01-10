import { PermissionsBitField } from 'discord.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

import WhiteList from '../whitelist.json' with { type: 'json' };

function hasPermissions(guild, permissions) {
  if (!guild || !guild.members || !guild.members.me) {
    return false;
  }

  const botMember = guild.members.me;
  if (!botMember || !botMember.permissions) {
    return false;
  }

  if (
    !permissions ||
    (Array.isArray(permissions) && permissions.length === 0)
  ) {
    return true;
  }

  try {
    if (typeof permissions === 'string') {
      if (PermissionsBitField.Flags[permissions]) {
        return botMember.permissions.has(
          PermissionsBitField.Flags[permissions],
        );
      }
      return false;
    }

    if (Array.isArray(permissions)) {
      return permissions.every((permission) => {
        if (
          typeof permission === 'string' &&
          PermissionsBitField.Flags[permission]
        ) {
          return botMember.permissions.has(
            PermissionsBitField.Flags[permission],
          );
        }
        return false;
      });
    }

    return botMember.permissions.has(permissions);
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'permissionsUtils.js',
      action: 'hasPermissions',
      guildId: guild?.id,
      permissions: permissions,
    });
    return false;
  }
}

function hasAuditLogPermission(guild) {
  if (!guild || !guild.members || !guild.members.me) {
    return false;
  }
  return guild.members.me.permissions.has(
    PermissionsBitField.Flags.ViewAuditLog,
  );
}

function hasManageChannelsPermission(guild) {
  return hasPermissions(guild, ['ManageChannels']);
}

function hasManageWebhooksPermission(guild) {
  return hasPermissions(guild, ['ManageWebhooks']);
}

function hasManageRolesPermission(guild) {
  if (
    !guild ||
    !guild.members ||
    !guild.members.me ||
    !guild.members.me.permissions
  ) {
    return false;
  }

  try {
    return guild.members.me.permissions.has(
      PermissionsBitField.Flags.ManageRoles,
    );
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'permissionsUtils.js',
      action: 'hasManageRolesPermission',
      guildId: guild?.id,
    });
    return false;
  }
}

function hasKickMembersPermission(guild) {
  if (
    !guild ||
    !guild.members ||
    !guild.members.me ||
    !guild.members.me.permissions
  ) {
    return false;
  }

  try {
    return guild.members.me.permissions.has(
      PermissionsBitField.Flags.KickMembers,
    );
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'permissionsUtils.js',
      action: 'hasKickMembersPermission',
      guildId: guild?.id,
    });
    return false;
  }
}

function hasBanMembersPermission(guild) {
  if (!guild || !guild.members || !guild.members.me) {
    return false;
  }
  return guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers);
}

function hasModerateMembersPermission(guild) {
  if (
    !guild ||
    !guild.members ||
    !guild.members.me ||
    !guild.members.me.permissions
  ) {
    return false;
  }

  try {
    return guild.members.me.permissions.has(
      PermissionsBitField.Flags.ModerateMembers,
    );
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'permissionsUtils.js',
      action: 'hasModerateMembersPermission',
      guildId: guild?.id,
    });
    return false;
  }
}

function hasManageNicknamesPermission(guild) {
  return hasPermissions(guild, ['ManageNicknames']);
}

function hasReadMessagePermission(channel) {
  if (
    !channel ||
    !channel.guild ||
    !channel.guild.members ||
    !channel.guild.members.me
  ) {
    return false;
  }

  const permissions = channel.permissionsFor(channel.guild.members.me);
  if (!permissions) {
    return false;
  }

  return permissions.has([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
  ]);
}

function hasManageMessagesPermission(channel) {
  if (!channel || !channel.guild || !channel.guild.members.me) {
    return false;
  }

  const channelPermissions = channel.permissionsFor(channel.guild.members.me);
  if (!channelPermissions) {
    return false;
  }
  return channelPermissions.has(PermissionsBitField.Flags.ManageMessages);
}

async function canUserModerateTarget(guild, userId, targetUserId) {
  const user = await guild.members.fetch(userId);
  const target = await guild.members.fetch(targetUserId);

  if (!user || !target) return false;

  if (userId === guild.ownerId) return true;

  if (userId === targetUserId) return false;

  if (targetUserId === guild.ownerId) return false;

  return user.roles.highest.position > target.roles.highest.position;
}

async function canModerateUser(guild, userId) {
  const botMember = guild.members.me;
  if (!botMember) return false;

  if (userId === guild.ownerId) return false;

  const targetMember = await guild.members.fetch(userId).catch(() => null);
  if (!targetMember) return true;

  if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
    return false;
  }

  return true;
}

async function safeDeleteMessage(message) {
  try {
    if (!message || !message.deletable) {
      return false;
    }

    await message.delete();
    return true;
  } catch (error) {
    if (error.code === 10008) {
      return false;
    }

    triggerErrorEmbed(error, {
      source: 'permissionsUtils.js',
      action: 'safeDeleteMessage',
      messageId: message?.id,
      channelId: message?.channel?.id,
      guildId: message?.guild?.id,
    });
    return false;
  }
}

async function checkModerationPermissions(message, userId, action) {
  const guild = message.guild;
  const botMember = guild.members.me;
  const authorId = message.author.id;

  if (!userId || typeof userId !== 'string') {
    return {
      error: 'invalid_user_id',
      message: 'ID utilisateur invalide ou manquant.',
      solution:
        '➤ **Solution :** Fournissez un ID utilisateur valide (format: 123456789012345678)',
    };
  }

  const snowflakeRegex = /^[0-9]{17,20}$/;
  if (!snowflakeRegex.test(userId)) {
    return {
      error: 'invalid_snowflake',
      message: "Format d'ID utilisateur invalide.",
      solution:
        "➤ **Solution :** L'ID utilisateur doit contenir uniquement des chiffres (17-20 caractères)",
    };
  }

  const permissionChecks = {
    mute: {
      permission: 'ModerateMembers',
      hasPermission: () =>
        botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers),
      missingMessage:
        "Je n'ai pas la permission 'Exclure temporairement les membres' nécessaire pour muter des utilisateurs.",
      solution:
        "➤ **Solution :** Paramètres du serveur > Rôles > Mon rôle > Cochez 'Exclure temporairement les membres'",
    },
    ban: {
      permission: 'BanMembers',
      hasPermission: () =>
        botMember.permissions.has(PermissionsBitField.Flags.BanMembers),
      missingMessage:
        "Je n'ai pas la permission 'Bannir des membres' nécessaire pour bannir des utilisateurs.",
      solution:
        "➤ **Solution :** Paramètres du serveur > Rôles > Mon rôle > Cochez 'Bannir des membres'",
    },
    kick: {
      permission: 'KickMembers',
      hasPermission: () =>
        botMember.permissions.has(PermissionsBitField.Flags.KickMembers),
      missingMessage:
        "Je n'ai pas la permission 'Expulser des membres' nécessaire pour expulser des utilisateurs.",
      solution:
        "➤ **Solution :** Paramètres du serveur > Rôles > Mon rôle > Cochez 'Expulser des membres'",
    },
    nickname: {
      permission: 'ManageNicknames',
      hasPermission: () =>
        botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames),
      missingMessage:
        "Je n'ai pas la permission 'Gérer les pseudos' nécessaire pour modifier les pseudos des utilisateurs.",
      solution:
        "➤ **Solution :** Paramètres du serveur > Rôles > Mon rôle > Cochez 'Gérer les pseudos'",
    },
  };

  const check = permissionChecks[action];
  if (!check) {
    return {
      error: 'unknown_action',
      message: 'Action de modération inconnue.',
    };
  }

  if (!check.hasPermission()) {
    return {
      error: 'missing_permissions',
      detail: check.permission,
      message: check.missingMessage,
      solution: check.solution,
    };
  }

  let targetMember;
  try {
    targetMember = await guild.members.fetch(userId);
  } catch (error) {
    if (error.code === 10007) {
      return {
        error: 'member_not_found',
        message: "L'utilisateur spécifié n'est pas membre de ce serveur.",
        solution:
          "➤ **Solution :** Vérifiez que l'utilisateur est bien sur le serveur",
      };
    }
    if (error.code === 10013) {
      return {
        error: 'unknown_user',
        message: 'Utilisateur inconnu ou ID invalide.',
        solution:
          "➤ **Solution :** Vérifiez l'ID utilisateur et assurez-vous qu'il existe sur Discord",
      };
    }
    if (error.code === 50035) {
      return {
        error: 'invalid_user_format',
        message: "Format d'ID utilisateur invalide.",
        solution:
          '➤ **Solution :** Utilisez un ID utilisateur valide (ex: 123456789012345678)',
      };
    }

    if (![50035, 10007, 50001, 50013, 10013].includes(error.code)) {
      triggerErrorEmbed(error, {
        source: 'permissionsUtils.js',
        action: 'checkModerationPermissions_fetchMember',
        userId: userId,
        guildId: guild?.id,
        errorCode: error.code,
      });
    }

    return {
      error: 'fetch_member_failed',
      message: "Impossible de récupérer les informations de l'utilisateur.",
      solution:
        "➤ **Solution :** Vérifiez l'ID utilisateur ou réessayez plus tard",
    };
  }

  if (targetMember.id === guild.client.user.id) {
    return {
      success: true,
      targetMember,
    };
  }

  if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
    return {
      error: 'bot_role_hierarchy',
      message: `Je ne peux pas modérer <@${userId}> car cette personne possède un rôle plus haut ou égal au mien dans la hiérarchie.`,
      solution: `➤ **Solution :** Glissez mon rôle <@&${botMember.roles.highest.id}> AU-DESSUS du rôle de <@${userId}> dans la liste des rôles`,
    };
  }

  if (!WhiteList.OwnerByPass.includes(authorId) && authorId !== guild.ownerId) {
    try {
      const authorMember = await guild.members.fetch(authorId);

      if (
        targetMember.roles.highest.position >=
        authorMember.roles.highest.position
      ) {
        return {
          error: 'user_role_hierarchy',
          message: `Vous ne pouvez pas modérer <@${userId}> car cette personne possède un rôle supérieur ou égal au vôtre dans la hiérarchie.`,
          solution: `➤ **Solution :** Seuls les utilisateurs avec un rôle plus élevé que <@&${targetMember.roles.highest.id}> peuvent modérer cette personne.`,
        };
      }
    } catch (error) {
      if (![10007, 50001, 50013].includes(error.code)) {
        triggerErrorEmbed(error, {
          source: 'permissionsUtils.js',
          action: 'checkModerationPermissions_fetchAuthor',
          userId: authorId,
          guildId: guild?.id,
        });
      }
      return {
        error: 'hierarchy_check_failed',
        message: 'Impossible de vérifier la hiérarchie des rôles.',
        solution: '➤ **Solution :** Contactez un administrateur',
      };
    }
  }

  return {
    success: true,
    targetMember,
  };
}

async function executeModeration(action) {
  await action();
  return true;
}

export {
  canModerateUser,
  canUserModerateTarget,
  checkModerationPermissions,
  executeModeration,
  hasAuditLogPermission,
  hasBanMembersPermission,
  hasKickMembersPermission,
  hasManageChannelsPermission,
  hasManageMessagesPermission,
  hasManageNicknamesPermission,
  hasManageRolesPermission,
  hasManageWebhooksPermission,
  hasModerateMembersPermission,
  hasPermissions,
  hasReadMessagePermission,
  safeDeleteMessage,
};

