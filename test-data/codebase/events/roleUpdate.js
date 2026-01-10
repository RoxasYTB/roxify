import { Events } from 'discord.js';
import { checkShards } from '../utils/checkShards.js';
import { findLogChannel, hasAuditLogPermission } from '../utils/logUtils.js';
import { logRoleUpdated } from '../utils/roleUtils.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = Events.GuildRoleUpdate;
export async function execute(oldRole, newRole, shardId) {
  if (newRole.guild && shouldPauseGuild(newRole.guild.id)) {
    return;
  }
  if (!checkShards(newRole, shardId) || !hasAuditLogPermission(newRole.guild))
    return;
  const logChannel = findLogChannel(newRole.guild, 'role');
  if (!logChannel || !newRole.guild.channels.cache.some((ch) => ch.type === 0))
    return;
  await logRoleUpdated(oldRole, newRole, 'fr');
}

