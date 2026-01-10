import { Events } from 'discord.js';
import { checkShards } from '../utils/checkShards.js';
import { hasAuditLogPermission } from '../utils/logUtils.js';
import { logRoleDeleted } from '../utils/roleUtils.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = Events.GuildRoleDelete;
export async function execute(role, shardId) {
  if (role.guild && shouldPauseGuild(role.guild.id)) {
    return;
  }
  if (!checkShards(role, shardId) || !hasAuditLogPermission(role.guild)) return;
  await logRoleDeleted(role, 'fr');
}

