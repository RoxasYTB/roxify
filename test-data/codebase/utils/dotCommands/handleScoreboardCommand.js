import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../../config/config.js';
import { formatNumber } from '../coreUtils.js';
import { getAllGuilds } from '../guildUtils.js';
import triggerErrorEmbed from '../triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function updateServersJson(client) {
  const allGuilds = await getAllGuilds(client);
  const filteredGuilds = allGuilds.filter((guild) => guild.name !== '𝓞𝓷𝓵𝔂𝓑𝓸𝓽𝓼');
  if (!filteredGuilds || filteredGuilds.length === 0) return [];
  const sortedGuilds = filteredGuilds
    .filter((guild) => guild.memberCount && guild.memberCount > 0)
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 20);
  if (sortedGuilds.length === 0) return [];
  const detailedGuilds = await getDetailedGuildInfo(
    client,
    sortedGuilds.slice(0, 10),
  );

  try {
    const serversData = detailedGuilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      members: guild.memberCount,
      premiumTier: guild.premiumTier,
      createdTimestamp: guild.createdTimestamp,
      icon: guild.iconURL || null,
    }));
    const filePath = path.join(__dirname, '../../servers.json');
    fs.writeFileSync(filePath, JSON.stringify(serversData, null, 2), 'utf8');
    return serversData;
  } catch (err) {
    console.error(
      "Erreur lors de l'écriture du classement des serveurs dans servers.json:",
      err,
    );
    return [];
  }
}

export default async function handleScoreboardCommand(
  message,
  isLeaderboard = false,
) {
  try {
    const title =
      isLeaderboard ?
        '🏆 Leaderboard des serveurs'
      : '📊 Scoreboard des serveurs';
    const serversData = await updateServersJson(message.client);
    if (!serversData || serversData.length === 0) {
      return message.reply('Aucun serveur trouvé.');
    }
    const embed = new EmbedBuilder().setColor(embedColor).setTitle(title);
    let description = '';
    serversData.forEach((guild, index) => {
      if (!guild) return;
      if (guild.name === '𝓞𝓷𝓵𝔂𝓑𝓸𝓽𝓼') return;
      const position = index + 1;
      const medal =
        position === 1 ? '🥇'
        : position === 2 ? '🥈'
        : position === 3 ? '🥉'
        : `#${position}`;
      const memberCount = guild.members || 0;
      const guildName =
        guild.name ? guild.name.substring(0, 30) : 'Nom inconnu';
      description += `┃ ${medal} **${guildName}** - ${formatNumber(memberCount)} membres\n`;
    });
    description += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    let realPosition = null;
    let realMemberCount = null;
    let realGuildName = null;
    const allGuilds = await getAllGuilds(message.client);
    const allSortedGuilds = allGuilds
      .filter((guild) => guild.memberCount && guild.memberCount > 0)
      .sort((a, b) => b.memberCount - a.memberCount);
    if (message.guild?.id) {
      const idx = allSortedGuilds.findIndex((g) => g.id === message.guild.id);
      if (idx !== -1) {
        realPosition = idx + 1;
        realMemberCount = allSortedGuilds[idx].memberCount;
        realGuildName =
          allSortedGuilds[idx].name ?
            allSortedGuilds[idx].name.substring(0, 30)
          : 'Nom inconnu';
      }
    }

    if (realPosition) {
      description += `\n➡️ Ce serveur : **${realGuildName}** est classé #${realPosition} sur ${allSortedGuilds.length} avec ${formatNumber(realMemberCount)} membres.`;
    } else {
      description += "\nCe serveur n'est pas dans le classement global.";
    }
    embed.setDescription(description);
    await message.channel.send({ embeds: [embed] });
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

async function getDetailedGuildInfo(client, guildList) {
  if (!client.shard && !client.cluster) {
    const results = [];
    for (const guildInfo of guildList) {
      const guild = await client.guilds.fetch(guildInfo.id);
      results.push({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        premiumTier: guild.premiumTier,
        createdTimestamp: guild.createdTimestamp,
        iconURL: guild.iconURL({ dynamic: true, size: 64 }),
      });
    }
    return results;
  }

  const guildIds = guildList.map((g) => g.id);
  let detailedResults = [];
  if (client.cluster && typeof client.cluster.broadcastEval === 'function') {
    const results = await client.cluster.broadcastEval(
      async (c, { guildIds }) => {
        const foundGuilds = [];
        for (const guildId of guildIds) {
          const guild = c.guilds.cache.get(guildId);
          if (guild) {
            await guild.fetch();
            foundGuilds.push({
              id: guild.id,
              name: guild.name,
              memberCount: guild.memberCount,
              premiumTier: guild.premiumTier,
              createdTimestamp: guild.createdTimestamp,
              iconURL: guild.iconURL({ dynamic: true, size: 64 }),
            });
          }
        }
        return foundGuilds;
      },
      {
        context: { guildIds },
      },
    );
    detailedResults = results.flat();
  }

  if (
    detailedResults.length === 0 &&
    client.shard &&
    typeof client.shard.broadcastEval === 'function'
  ) {
    const results = await client.shard.broadcastEval(
      async (c, { guildIds }) => {
        const foundGuilds = [];
        for (const guildId of guildIds) {
          const guild = c.guilds.cache.get(guildId);
          if (guild) {
            await guild.fetch();
            foundGuilds.push({
              id: guild.id,
              name: guild.name,
              memberCount: guild.memberCount,
              premiumTier: guild.premiumTier,
              createdTimestamp: guild.createdTimestamp,
              iconURL: guild.iconURL({ dynamic: true, size: 64 }),
            });
          }
        }
        return foundGuilds;
      },
      {
        context: { guildIds },
      },
    );
    detailedResults = results.flat();
  }

  const finalResults = guildList.map((basicInfo) => {
    const detailedInfo = detailedResults.find(
      (detailed) => detailed.id === basicInfo.id,
    );
    return detailedInfo || basicInfo;
  });

  return finalResults;
}

