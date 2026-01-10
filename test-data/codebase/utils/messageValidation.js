const channelMentionRegex = /<#(\d+)>/g;
const emojiRegex = /<a?:\w*glados\w*:\d{17,19}>/gi;
const gifRegex =
  /^https?:\/\/(?:www\.)?tenor\.com\/view\/[^\s]*glados[^\s]*-gif-\d+$/i;
const combRegex = /comb|comn/;
const servRegex = /serv/;
const insoRegex = /inso|mecha|clash/;
const blaguRegex = /blagu/;

let blacklistCache = {
  data: [],
  lastUpdated: 0,
  ttl: 1000,
};

function processMessageContent(message) {
  let processedContent = message.content;

  if (message.guild && processedContent) {
    processedContent = processedContent
      .replace(channelMentionRegex, (match, channelId) => {
        const channel = message.guild.channels.cache.get(channelId);
        return channel ? channel.name : match;
      })
      .replace('moi ', 'moi (à ' + message.author.id + ') ');
  }

  return processedContent;
}

function checkEmojiTrigger(content) {
  return emojiRegex.test(content);
}

function checkGifTrigger(content) {
  return gifRegex.test(content.trim());
}

function checkContentTriggers(content) {
  const hasGlados = content.includes('glados');

  return {
    hasGlados,
    isCombServ: hasGlados && combRegex.test(content) && servRegex.test(content),
    isInso: hasGlados && insoRegex.test(content),
    isBlagu: hasGlados && blaguRegex.test(content),
  };
}

function isBotTriggered(message, processedContent) {
  const isMentioned =
    message.mentions.has(message.client.user) && !message.mentions.everyone;

  const botNameLower =
    message.guild.members.me?.nickname?.toLowerCase() || 'glados';
  const contentLower = processedContent.toLowerCase();

  const isNameTrigger =
    contentLower.includes('glados') || contentLower.includes(botNameLower);

  const onlySpeakThisChannels = [
    {
      serverId: '1272160243706626100',
      commandChannelId: '1397599098823245864',
    },
    {
      serverId: '1398615508328120410',
      commandChannelId: '1398651368893317291',
    },
  ];

  const isTheOnlyChannelOnRestrictedServerWeCanSpeak =
    onlySpeakThisChannels.some(
      ({ serverId, commandChannelId }) =>
        message.guild?.id === serverId &&
        message.channel?.id === commandChannelId,
    );

  const isInRestrictedServer = onlySpeakThisChannels.some(
    ({ serverId }) => message.guild?.id === serverId,
  );

  return (
    !message.author.bot &&
    (isMentioned || isNameTrigger) &&
    processedContent.trim().length > 0 &&
    (!isInRestrictedServer || isTheOnlyChannelOnRestrictedServerWeCanSpeak)
  );
}

function updateBlacklistCache() {
  return {
    data: blacklistCache.data,
    lastUpdated: blacklistCache.lastUpdated,
    ttl: blacklistCache.ttl,
    needsUpdate: Date.now() - blacklistCache.lastUpdated > blacklistCache.ttl,
  };
}

function setBlacklistCache(data) {
  blacklistCache.data = data;
  blacklistCache.lastUpdated = Date.now();
}

export {
  blaguRegex,
  channelMentionRegex,
  checkContentTriggers,
  checkEmojiTrigger,
  checkGifTrigger,
  combRegex,
  emojiRegex,
  insoRegex,
  isBotTriggered,
  processMessageContent,
  servRegex,
  setBlacklistCache,
  updateBlacklistCache,
};

function hasMediaContent(message) {
  if (message.attachments && message.attachments.size > 0) {
    return true;
  }

  if (message.stickers && message.stickers.size > 0) {
    return true;
  }

  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.image || embed.video || embed.thumbnail) {
        return true;
      }
    }
  }

  if (message.components && message.components.length > 0) {
    for (const component of message.components) {
      if (
        component.type === 2 &&
        component.customId &&
        component.customId.includes('media')
      ) {
        return true;
      }
    }
  }
  return false;
}

export { hasMediaContent };

