import { Events } from 'discord.js';
import { checkShards } from '../utils/checkShards.js';
import { logMessageDeleted } from '../utils/messageUtils.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = Events.MessageDelete;
export async function execute(message, shardId) {
  if (message.guild && shouldPauseGuild(message.guild.id)) {
    return;
  }

  if (!message) {
    return;
  }

  if (!checkShards(message, shardId)) {
    return;
  }

  if (!message.author || message.system) {
    return;
  }

  if (message.author.bot) {
    return;
  }

  if (!message.guild || !message.guild.id) {
    return;
  }

  await logMessageDeleted(message);
}

