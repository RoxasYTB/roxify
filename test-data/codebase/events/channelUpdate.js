import { Events } from 'discord.js';
import { hasEncodedMarkers, restoreMarkersIfNeeded } from '../utils/3y3.js';
import { logChannelUpdated } from '../utils/channelUtils.js';
import { checkShards } from '../utils/checkShards.js';
import { safeExecute } from '../utils/coreUtils.js';
import { handleChannelUpdate } from '../utils/handleChannelUpdate.js';
import { hasAuditLogPermission } from '../utils/permissionsUtils.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = Events.ChannelUpdate;
export async function execute(oldChannel, newChannel, shardId) {
  if (newChannel.guild && shouldPauseGuild(newChannel.guild.id)) {
    return;
  }

  return safeExecute(
    async () => {
      if (
        !checkShards(newChannel, shardId) ||
        !hasAuditLogPermission(newChannel.guild)
      )
        return;

      if (oldChannel.topic != newChannel.topic) {
        const oldHadMarkers = hasEncodedMarkers(oldChannel.topic || '');
        const newHasMarkers = hasEncodedMarkers(newChannel.topic || '');

        if (oldHadMarkers && !newHasMarkers) {
          const auditLogs = await newChannel.guild
            .fetchAuditLogs({
              type: 11,
              limit: 1,
            })
            .catch(() => null);

          const latestLog = auditLogs?.entries.first();
          const isGladosUpdate =
            latestLog?.executor?.id == newChannel.client.user.id;

          if (!isGladosUpdate) {
            const restoredDescription = restoreMarkersIfNeeded(
              oldChannel.topic,
              newChannel.topic,
            );
            if (restoredDescription != newChannel.topic) {
              await newChannel.setTopic(restoredDescription).catch(() => {});
            }
          }
        }
      }

      handleChannelUpdate(oldChannel, newChannel);

      const onlyPositionChanged =
        oldChannel.position != newChannel.position &&
        oldChannel.name == newChannel.name &&
        oldChannel.topic == newChannel.topic &&
        oldChannel.type == newChannel.type &&
        oldChannel.parentId == newChannel.parentId &&
        oldChannel.permissionOverwrites.cache.size ==
          newChannel.permissionOverwrites.cache.size;

      if (!onlyPositionChanged) {
        await logChannelUpdated(oldChannel, newChannel, 'fr');
      }
    },
    {
      command: 'channelUpdate',
      guildId: newChannel?.guild?.id,
      channelId: newChannel?.id,
      client: newChannel?.client,
    },
  );
}

