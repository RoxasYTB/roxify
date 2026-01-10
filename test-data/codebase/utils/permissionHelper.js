import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import WhiteList from '../whitelist.json' with { type: 'json' };
import triggerErrorEmbed from './triggerErrorEmbed.js';

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

  const permsArray = Array.isArray(permissions) ? permissions : [permissions];

  return permsArray.every((permission) => {
    try {
      return botMember.permissions.has(PermissionFlagsBits[permission]);
    } catch (error) {
      triggerErrorEmbed(
        error,
        guild.client?.user?.username,
        guild.client?.user?.displayAvatarURL(),
      );
      return false;
    }
  });
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

async function canUserModerateTarget(guild, userId, targetUserId) {
  const user = await guild.members.fetch(userId);
  const target = await guild.members.fetch(targetUserId);

  if (!user || !target) return false;

  if (userId === guild.ownerId) return true;

  if (userId === targetUserId) return false;

  if (targetUserId === guild.ownerId) return false;

  return user.roles.highest.position > target.roles.highest.position;
}

function hasManageChannelsPermission(guild) {
  return hasPermissions(guild, ['ManageChannels']);
}

function hasModerateMembersPermission(guild) {
  return hasPermissions(guild, ['ModerateMembers']);
}

function hasBanMembersPermission(guild) {
  return hasPermissions(guild, ['BanMembers']);
}

function hasKickMembersPermission(guild) {
  return hasPermissions(guild, ['KickMembers']);
}

function hasManageNicknamesPermission(guild) {
  return hasPermissions(guild, ['ManageNicknames']);
}

function hasManageMessagesPermission(channel) {
  if (!channel || !channel.guild) {
    return false;
  }

  const guild = channel.guild;
  const botMember = guild.members.me;

  if (!botMember) {
    return false;
  }

  if (!botMember.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return false;
  }

  const channelPermissions = channel.permissionsFor(botMember);
  if (!channelPermissions) {
    return false;
  }

  return channelPermissions.has(PermissionsBitField.Flags.ManageMessages);
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

    triggerErrorEmbed(error, null, null);
    return false;
  }
}

async function checkModerationPermissions(message, userId) {
  const guild = message.guild;
  const authorId = message.author.id;
  const botMember = guild.members.me;

  const check = {
    hasPermission: () =>
      botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers),
    permission: 'MODERATE_MEMBERS',
    missingMessage:
      "Je n'ai pas les permissions nécessaires pour modérer les membres.",
    solution: '➤ **Solution :** Donnez-moi la permission "Modérer les membres"',
  };

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
    if (error.code === 50035) {
      return {
        error: 'invalid_user_format',
        message: "Format d'ID utilisateur invalide.",
        solution:
          '➤ **Solution :** Utilisez un ID utilisateur valide (ex: 123456789012345678)',
      };
    }
    if (![50035, 10007, 50001, 50013].includes(error.code)) {
      triggerErrorEmbed(
        error,
        guild.client?.user?.username,
        guild.client?.user?.displayAvatarURL(),
      );
    }
    throw error;
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
        triggerErrorEmbed(
          error,
          guild.client?.user?.username,
          guild.client?.user?.displayAvatarURL(),
        );
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

function hasManageRolesPermission(guild) {
  if (!guild || !guild.members || !guild.members.me) {
    return false;
  }

  try {
    return guild.members.me.permissions.has(
      PermissionsBitField.Flags.ManageRoles,
    );
  } catch (error) {
    triggerErrorEmbed(error, null, null);
    return false;
  }
}

export {
  canModerateUser,
  canUserModerateTarget,
  checkModerationPermissions,
  executeModeration,
  hasBanMembersPermission,
  hasKickMembersPermission,
  hasManageChannelsPermission,
  hasManageMessagesPermission,
  hasManageNicknamesPermission,
  hasManageRolesPermission,
  hasModerateMembersPermission,
  hasPermissions,
  safeDeleteMessage,
};

