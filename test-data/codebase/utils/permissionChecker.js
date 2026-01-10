import { PermissionsBitField } from 'discord.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

function hasPermissions(guild, permissions) {
  if (!guild || !guild.members || !guild.members.me) {
    return false;
  }

  const botMember = guild.members.me;
  if (!botMember || !botMember.permissions) {
    return false;
  }

  if (!permissions) {
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
    triggerErrorEmbed(
      error,
      guild.client?.user?.username,
      guild.client?.user?.displayAvatarURL(),
    );
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
  return hasPermissions(guild, 'ManageChannels');
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
    triggerErrorEmbed(error, null, null);
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
    triggerErrorEmbed(error, null, null);
    return false;
  }
}

function hasBanMembersPermission(guild) {
  if (!guild || !guild.members || !guild.members.me) {
    return false;
  }

  return guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers);
}

function hasModerateMembers(guild) {
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
    triggerErrorEmbed(error, null, null);
    return false;
  }
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

  return (
    channel
      .permissionsFor(channel.guild.members.me)
      ?.has(PermissionsBitField.Flags.ManageMessages) || false
  );
}

export {
  hasAuditLogPermission,
  hasBanMembersPermission,
  hasKickMembersPermission,
  hasManageChannelsPermission,
  hasManageMessagesPermission,
  hasManageRolesPermission,
  hasModerateMembers,
  hasPermissions,
  hasReadMessagePermission,
};

