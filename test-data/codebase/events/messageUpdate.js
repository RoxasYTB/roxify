import { Events, PermissionsBitField } from 'discord.js';
import { checkShards } from '../utils/checkShards.js';
import { findLogChannel } from '../utils/logUtils.js';
import {
  logMessageUpdated,
  validateCountMessage,
} from '../utils/messageUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = Events.MessageUpdate;
export async function execute(oldMessage, newMessage, shardId) {
  if (newMessage.guild && shouldPauseGuild(newMessage.guild.id)) {
    return;
  }
  if (
    !checkShards(newMessage, shardId) ||
    !newMessage.guild?.members.me.permissions.has(
      PermissionsBitField.Flags.ViewAuditLog,
    ) ||
    oldMessage.content == newMessage.content ||
    newMessage.author.id == newMessage.client.user.id
  )
    return;
  if (
    !(await validateCountMessage(newMessage, {
      client: newMessage.client,
    }))
  )
    return;

  const logChannel = findLogChannel(newMessage.guild, 'message');
  if (logChannel) {
    try {
      await logMessageUpdated(oldMessage, newMessage, 'fr');
    } catch (error) {
      triggerErrorEmbed(
        error,
        newMessage.client?.user?.username,
        newMessage.client?.user?.displayAvatarURL(),
      );
    }
  }
}

