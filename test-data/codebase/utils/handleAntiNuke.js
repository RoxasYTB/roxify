import { AuditLogEvent } from 'discord.js';
import {
  canUserBeBanned,
  markBotAsMalicious,
  recordBlockedAction,
} from './antiRaidCoordinator.js';
import { isServerEmptyAfterRaid } from './handleChannelCreateRaid.js';
import { startServerRestoration } from './handleMassiveDeletion.js';

async function handleAntiNuke(channel) {
  if (!channel.guild || !channel.guild.available) return;
  if (!channel.client.token) return;

  const r = await fetch(
    `http://localhost:6542/api/thread-backups/${channel.guild.id}`,
  );
  if (!r.ok) return;
  const backupData = await r.json();
  if (!backupData) return;

  const { entries } = await channel.guild.fetchAuditLogs({
    limit: 1,
    type: AuditLogEvent.ChannelDelete,
  });
  const executor = entries.first()?.executor;

  if (executor?.bot) {
    if (canUserBeBanned(executor.id, channel.guild.id)) {
      markBotAsMalicious(executor.id);
      recordBlockedAction(channel.guild.id, 'channel_delete_mass', executor.id);

      await channel.guild.members.ban(executor.id, {
        reason:
          'Bot ayant tenté de nuker le serveur - Permissions retirées puis banni',
      });

      const serverEmpty = isServerEmptyAfterRaid(channel.guild);

      if (serverEmpty) {
        await startServerRestoration(channel.guild, executor.id);
      }
    } else {
      markBotAsMalicious(executor.id);
      recordBlockedAction(
        channel.guild.id,
        'channel_delete_owner_mass',
        executor.id,
      );
    }
  } else if (executor) {
    recordBlockedAction(channel.guild.id, 'channel_delete_human', executor.id);
  }

  await channel.guild.setName(backupData.serverName);
  const antiNukeChannel = channel.guild.channels.cache.find(
    (c) => c.name === 'anti-nuke' || c.name === 'anti-nuke-urgence',
  );
  if (antiNukeChannel) {
    await antiNukeChannel.delete();
  }
}

export { handleAntiNuke };

