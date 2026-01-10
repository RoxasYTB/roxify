import { getAllGuilds } from '../guildUtils.js';
import triggerErrorEmbed from '../triggerErrorEmbed.js';

export default async function getServeursEnCommun(m) {
  try {
    const author = m.author;
    const bot = m.client.user;
    const allGuilds = await getAllGuilds(m.client);

    let commonGuildsCount = 0;

    if (m.client.shard && typeof m.client.shard.broadcastEval === 'function') {
      const results = await m.client.shard.broadcastEval(
        async (client, { authorId, botId, guildIds }) => {
          let count = 0;
          for (const guildId of guildIds) {
            const guild = client.guilds.cache.get(guildId);
            if (
              guild &&
              guild.members.cache.has(authorId) &&
              guild.members.cache.has(botId)
            ) {
              count++;
            }
          }
          return count;
        },
        {
          context: {
            authorId: author.id,
            botId: bot.id,
            guildIds: allGuilds.map((g) => g.id),
          },
        },
      );

      commonGuildsCount = results.reduce((total, count) => total + count, 0);
    } else {
      for (const g of allGuilds) {
        const guild = await m.client.guilds.fetch(g.id).catch(() => null);
        if (
          guild &&
          guild.members.cache.has(author.id) &&
          guild.members.cache.has(bot.id)
        ) {
          commonGuildsCount++;
        }
      }
    }

    m.reply(`${commonGuildsCount}`);
  } catch (e) {
    triggerErrorEmbed(e, {
      userId: m.author?.id,
      source: 'getServeursEnCommun.js',
      action: 'getCommonServers',
    });
  }
}

