import { cacheGet, cacheSet } from './coreUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

module.exports.parseDiscordMentions = async (client, message) => {
  if (!message || !client) return message;
  const replacements = [
    {
      regex: /<@!?(\d+)>/g,
      fetch: async (id) => {
        const cleanId = id.replace('!', '');
        const cacheKey = `user_${cleanId}`;
        let user = cacheGet(cacheKey);
        if (!user) {
          user = await client.users.fetch(cleanId);
          cacheSet(cacheKey, user, 3600000);
        }
        return user;
      },
      replace: (user) => `@${user.username}`,
    },
    {
      regex: /<#(\d+)>/g,
      fetch: async (id) => {
        const cacheKey = `channel_${id}`;
        let channel = cacheGet(cacheKey);
        if (!channel) {
          channel = await client.channels.fetch(id);
          cacheSet(cacheKey, channel, 3600000);
        }
        return channel;
      },
      replace: (channel) => `#${channel.name}`,
      errorValue: '#MentionnedChannel',
    },
    {
      regex: /<@&[^>]*>/g,
      replace: () => '@MentionnedRole',
    },
  ];
  let processedMessage = message;
  for (const { regex, fetch, replace, errorValue } of replacements) {
    const matches = [...processedMessage.matchAll(regex)];
    if (matches.length === 0) continue;
    const promises = matches.map(async ([mention, id]) => {
      if (fetch) {
        try {
          return replace(await fetch(id));
        } catch (fetchError) {
          triggerErrorEmbed(
            fetchError,
            client?.user?.username,
            client?.user?.displayAvatarURL(),
          );
          return [mention, errorValue];
        }
      } else return replace();
    });
    const replacedValues = await Promise.all(promises);
    for (let i = 0; i < matches.length; i++)
      processedMessage = processedMessage.replace(
        matches[i][0],
        replacedValues[i],
      );
  }
  return processedMessage;
};

