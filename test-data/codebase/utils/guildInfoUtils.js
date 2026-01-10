import { cacheGet, cacheSet, formatNumber } from './coreUtils.js';
import { extractChannelStyle } from './roomNameExtractor.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';
async function getServerContextInfo(message) {
  if (!message || !message.guild) {
    return {
      channelInfo: '',
      serverInfo: '',
      roleInfo: '',
      serverInfoEmbedSent: false,
    };
  }

  const cacheKey = `serverContext_${message.guild.id}_${message.content}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let channelInfo = '',
    serverInfo = '',
    roleInfo = '',
    serverInfoEmbedSent = false;

  let channelStyleInfo = '';
  try {
    const styleInfo = extractChannelStyle(message.guild);
    channelStyleInfo = `Style des salons détecté: ${styleInfo.preset}. ${styleInfo.description}\n`;
  } catch {
    channelStyleInfo = '';
  }

  if (
    /salon|catégorie|categorie|créer/.test(message.content) &&
    !/comb/.test(message.content)
  ) {
    try {
      const channels = await message.guild.channels.fetch();
      if (channels) {
        const sorted = [...channels.values()].sort(
          (a, b) => a.position - b.position,
        );
        const categories = sorted.filter((c) => c.type === 4);
        channelInfo = categories.map((cat) => {
          const catCh = sorted
            .filter((c) => c.parentId === cat.id)
            .sort((a, b) => a.position - b.position);
          return `Catégorie : ${cat.name}\n${catCh.length ? catCh.map((ch) => `  - ${ch.type === 0 ? 'Textuel' : 'Vocal'} : ${ch.name}`).join('\n') : 'Aucun salon dans cette catégorie.'}`;
        });
        const uncategorized = sorted
          .filter((c) => !c.parentId && [0, 2].includes(c.type))
          .map(
            (ch) => `  - ${ch.type === 0 ? 'Textuel' : 'Vocal'} : ${ch.name}`,
          )
          .join('\n');
        channelInfo = `${channelStyleInfo}${channelInfo}\n${uncategorized ? `Salons sans catégorie:\n${uncategorized}` : ''}\nJe parle actuellement dans le salon "${message.channel?.name || 'Inconnu'}"\n`;
      }
    } catch {
      channelInfo = `${channelStyleInfo}Erreur lors de la récupération des salons.\n`;
    }
  }
  if (
    /rôle|role/.test(message.content) &&
    !/comb|créer|cré|suppr|supprimer|delete|create|remove|ajouter|add/.test(
      message.content,
    )
  ) {
    try {
      const roles = await message.guild.roles.fetch();
      if (roles) {
        roleInfo =
          'Liste des rôles:\n' +
          roles
            .filter((r) => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map((r) => `(${r.id}) ${r.name} `)
            .join('\n') +
          '\n';
      }
    } catch {
      roleInfo = 'Erreur lors de la récupération des rôles.\n';
    }
  }

  const result = {
    channelInfo,
    serverInfo,
    roleInfo,
    serverInfoEmbedSent,
  };

  cacheSet(cacheKey, result, 60000);
  return result;
}

function getBotInfo(client, authorId, translateInto, WhiteList) {
  if (!client || !client.user) {
    return '';
  }

  try {
    const guildCount = client.guilds.cache.size;
    const totalUsers = client.guilds.cache.reduce(
      (a, g) => a + (g.memberCount || 0),
      0,
    );

    return {
      guildCount: formatNumber(guildCount),
      totalUsers: formatNumber(totalUsers),
      botName: WhiteList.BotName,
      isAdmin: WhiteList.OwnerByPass.includes(authorId),
      username: client.user.username,
      translateInto,
    };
  } catch (error) {
    triggerErrorEmbed(
      error,
      client?.user?.username,
      client?.user?.displayAvatarURL(),
    );
    return '';
  }
}

export { getBotInfo, getServerContextInfo };

