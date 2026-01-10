import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAccurateProjectStats } from './accurateStatsCalculator.js';
import { formatNumber } from './coreUtils.js';
import { getAllGuilds } from './guildUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function updateClusterStats(client) {
  try {
    if (!client || !client.guilds) {
      console.warn(
        '[STATS] Client non disponible pour la mise à jour des statistiques',
      );
      return;
    }

    const clustersDir = path.join(__dirname, '..', 'clusters');
    const clusterFilePath = path.join(clustersDir, 'cluster-0.json');

    let existingData = {};
    if (fs.existsSync(clusterFilePath)) {
      try {
        const fileContent = fs.readFileSync(clusterFilePath, 'utf8');
        existingData = JSON.parse(fileContent);
      } catch (parseError) {
        console.warn(
          '[STATS] Erreur lors de la lecture du fichier cluster-0.json:',
          parseError.message,
        );
        existingData = {};
      }
    }

    let allGuilds;
    try {
      const guildPromise = getAllGuilds(client);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000),
      );

      allGuilds = await Promise.race([guildPromise, timeoutPromise]);
    } catch {
      if (client.guilds && client.guilds.cache) {
        if (typeof client.guilds.cache.map === 'function') {
          allGuilds = client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
          }));
        } else {
          allGuilds = Array.from(client.guilds.cache.values()).map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
          }));
        }
      } else {
        allGuilds = [];
      }
    }

    const totalMembers = allGuilds.reduce(
      (sum, guild) => sum + (guild.memberCount || 0),
      0,
    );
    const totalServers = allGuilds.length;

    let shardCount = 1;
    if (client && client.shard && Array.isArray(client.shard.ids)) {
      shardCount = client.shard.count || client.shard.ids.length || 1;
    }

    const scaledTotalMembers = Math.round(totalMembers * Math.sqrt(shardCount));

    const memoryUsageMB = Math.round(
      process.memoryUsage().heapUsed / 1024 / 1024,
    );

    let totalLines = existingData.totalLines || 0;
    let projectSize = existingData.projectSize || '0 KB';
    try {
      const accurateStats = await getAccurateProjectStats();
      totalLines = accurateStats.totalLines;
      projectSize = accurateStats.sizeMessage;
    } catch (error) {
      console.warn(
        '[STATS] Impossible de calculer les statistiques précises:',
        error.message,
      );
    }

    const updatedStats = {
      ...existingData,
      totalServeurs: totalServers,
      totalMembers: scaledTotalMembers,
      memoryUsage: `${memoryUsageMB} MB`,
      totalLines: totalLines,
      projectSize: projectSize,
      lastUpdate: new Date().toISOString(),
    };

    fs.writeFileSync(clusterFilePath, JSON.stringify(updatedStats, null, 2));

    console.log(
      `[STATS] Statistiques mises à jour - Serveurs: ${totalServers}, Membres: ${formatNumber(
        scaledTotalMembers,
      )}, Mémoire: ${memoryUsageMB} MB`,
    );
  } catch (error) {
    console.error(
      '[STATS] Erreur lors de la mise à jour des statistiques:',
      error.message,
    );
  }
}

export { updateClusterStats };

