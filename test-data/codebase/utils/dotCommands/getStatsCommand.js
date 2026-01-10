import { EmbedBuilder, MessageFlags } from 'discord.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../../config/config.js';
import { formatNumber } from '../coreUtils.js';
import { getAllGuilds } from '../guildUtils.js';
import { getFilesInfos } from '../lineCounter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let statsCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 30000;

export default async function getStatsCommand(m) {
  try {
    const now = Date.now();
    if (statsCache && now - lastCacheTime < CACHE_DURATION) {
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('📊 Statistiques du bot')
        .addFields(
          {
            name: '👥 Utilisateurs',
            value: statsCache.totalMembers,
            inline: true,
          },
          {
            name: '🏠 Serveurs',
            value: statsCache.totalGuilds,
            inline: true,
          },
          {
            name: '',
            value: '',
            inline: false,
          },
          {
            name: '📝 Lignes de code',
            value: statsCache.totalLines,
            inline: true,
          },
          {
            name: '💾 Taille du projet',
            value: statsCache.totalSize,
            inline: true,
          },
        )
        .setImage('attachment://stats.png');

      return m.channel.send({
        embeds: [embed],
        files: [
          {
            attachment: 'http://localhost:9871/captcha-reverse/Stats',
            name: 'stats.png',
          },
        ],
      });
    }

    const clustersDir = path.join(__dirname, '..', '..', 'clusters');
    let memoryUsage = '0 MB',
      totalLines = '0',
      totalSize = '0 KB',
      totalMembersFromCache = 0,
      totalGuildsFromCache = 0;

    const statsPath = path.join(clustersDir, 'cluster-0.json');
    if (existsSync(statsPath)) {
      const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
      memoryUsage = stats.memoryUsage || '0 MB';
      totalLines = stats.totalLines || 0;
      totalSize = stats.totalSize || '0 KB';
      totalMembersFromCache = stats.totalMembers || 0;
      totalGuildsFromCache = stats.totalServeurs || 0;
    }

    let totalMembersAllGuilds = totalMembersFromCache;
    let totalGuilds = totalGuildsFromCache;

    let shardCount = 1;
    if (m.client && m.client.shard && Array.isArray(m.client.shard.ids)) {
      shardCount = m.client.shard.count || m.client.shard.ids.length || 1;
    }

    const usedCache = !(
      totalMembersFromCache === 0 || totalGuildsFromCache === 0
    );

    if (!usedCache) {
      const guildPromise = getAllGuilds(m.client);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000),
      );

      let allGuilds;
      try {
        allGuilds = await Promise.race([guildPromise, timeoutPromise]);
        totalMembersAllGuilds = allGuilds.reduce(
          (sum, guild) => sum + (guild.memberCount || 0),
          0,
        );
        totalGuilds = allGuilds.length;
      } catch {
        allGuilds = m.client.guilds.cache.map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.memberCount,
        }));
        totalMembersAllGuilds = allGuilds.reduce(
          (sum, guild) => sum + (guild.memberCount || 0),
          0,
        );
        totalGuilds = allGuilds.length;
      }

      if (m.client && m.client.shard && Array.isArray(m.client.shard.ids)) {
        shardCount = m.client.shard.count || m.client.shard.ids.length || 1;
      }

      totalMembersAllGuilds = Math.round(
        totalMembersAllGuilds * Math.sqrt(shardCount),
      );
    } else {
      totalMembersAllGuilds = totalMembersFromCache;
      totalGuilds = totalGuildsFromCache;
    }

    try {
      const filesInfo = await getFilesInfos();
      totalLines = filesInfo.totalLines || 0;
      totalSize = filesInfo.sizeMessage || '0 KB';
    } catch {}

    const f = {
      totalMembers: formatNumber(totalMembersAllGuilds),
      totalGuilds: formatNumber(totalGuilds),
      memoryUsage,
      totalLines: formatNumber(totalLines),
      totalSize,
    };
    statsCache = f;
    lastCacheTime = now;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('📊 Statistiques du bot')
      .addFields(
        {
          name: '👥 Utilisateurs',
          value: f.totalMembers,
          inline: true,
        },
        {
          name: '🏠 Serveurs',
          value: f.totalGuilds,
          inline: true,
        },
        {
          name: '',
          value: '',
          inline: false,
        },
        {
          name: '💾 Taille du projet',
          value: f.totalSize,
          inline: true,
        },
        {
          name: '📝 Lignes de code',
          value: f.totalLines,
          inline: true,
        },
      )
      .setImage('attachment://stats.png');

    m.channel.send({
      embeds: [embed],
      files: [
        {
          attachment: 'http://localhost:9871/captcha-reverse/Stats',
          name: 'stats.png',
        },
      ],
    });
  } catch {
    m.reply({
      content:
        'Une erreur est survenue lors de la récupération des statistiques.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

