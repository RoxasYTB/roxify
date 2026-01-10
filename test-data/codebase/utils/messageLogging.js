import { generateInviteLink } from './inviteManager.js';
import { logColoredMessage } from './logger.js';

async function logBotTrigger(message, processedContent) {
  setImmediate(async () => {
    const guildId = message.guild?.id || 'DM';
    const userId = message.author.id;
    const userTag = message.author.tag;

    const inviteLink = await generateInviteLink(message);
    const memberCount = message.guild?.memberCount || 'N/A';
    const guildName = message.guild?.name || 'Message Direct';

    const logContent = [
      '==================================',
      `[GUILD] "${guildName}" (ID: ${guildId})`,
      `[MEMBERS] ${memberCount}`,
      `[USER] ${userTag} (ID: ${userId})`,
      `[INVITE] ${inviteLink}`,
      `[CHANNEL] #${message.channel?.name || 'DM'} (ID: ${message.channel?.id || 'N/A'})`,
      `[CONTENT] ${processedContent.replace(/\n/g, ' ')}`,
    ].join('\n');

    logColoredMessage(logContent);
  });
}

export { logBotTrigger };

