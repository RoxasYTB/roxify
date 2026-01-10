import { PermissionFlagsBits as F, OverwriteType } from 'discord.js';
import { getClosestChannel } from '../../utils/findClosestMatch.js';

export const managesendroom = async (m, n, unlock) => {
  const c = getClosestChannel(m.guild, n);
  if (!c) return;

  const everyone = m.guild.id;
  const bot = m.client.user.id;

  const permissions = [];

  if (everyone) {
    permissions.push({
      id: everyone,
      type: OverwriteType.Role,
      deny:
        unlock ?
          []
        : [F.SendMessages, F.CreatePublicThreads, F.CreatePrivateThreads],
      allow:
        unlock ?
          [F.SendMessages, F.CreatePublicThreads, F.CreatePrivateThreads]
        : [F.ViewChannel, F.ReadMessageHistory],
    });
  }

  if (bot) {
    permissions.push({
      id: bot,
      type: OverwriteType.Member,
      allow: [
        F.SendMessages,
        F.ViewChannel,
        F.ReadMessageHistory,
        F.CreatePublicThreads,
        F.CreatePrivateThreads,
      ],
    });
  }

  if (permissions.length > 0) {
    await c.permissionOverwrites.set(permissions);
  }
};

