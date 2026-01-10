import { Events } from 'discord.js';
import { checkShards } from '../utils/checkShards.js';
import { sendGuildNotification } from '../utils/response.js';

export const name = Events.GuildDelete;
export async function execute(guild, shardId) {
  if (!checkShards(guild, shardId, true) || !guild) return;

  await sendGuildNotification(guild.client, 'leave', guild);
}

