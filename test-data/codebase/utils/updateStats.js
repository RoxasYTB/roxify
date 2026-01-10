import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllGuilds } from './guildUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function updateClusterStats(client) {
  try {
    const clustersDir = path.join(__dirname, '..', 'clusters');
    const statsPath = path.join(clustersDir, 'cluster-0.json');

    try {
      await fs.promises.access(clustersDir);
    } catch {
      await fs.promises.mkdir(clustersDir, { recursive: true });
    }

    let clusterData = {};
    try {
      await fs.promises.access(statsPath);
      const fileContent = await fs.promises.readFile(statsPath, 'utf8');
      clusterData = JSON.parse(fileContent);
    } catch {
      console.warn(
        "[STATS] Erreur lors de la lecture du cluster-0.json, création d'un nouveau fichier",
      );
      clusterData = {};
    }

    let allGuilds;
    let totalMembersAllGuilds = 0;
    let totalGuilds = 0;

    try {
      const guildPromise = getAllGuilds(client);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000),
      );

      allGuilds = await Promise.race([guildPromise, timeoutPromise]);

      totalMembersAllGuilds = allGuilds.reduce(
        (sum, guild) => sum + (guild.memberCount || 0),
        0,
      );
      totalGuilds = allGuilds.length;
    } catch {
      const guildsFromCache = client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
      }));

      totalMembersAllGuilds = guildsFromCache.reduce(
        (sum, guild) => sum + (guild.memberCount || 0),
        0,
      );

      totalGuilds = guildsFromCache.length;

      console.log(
        `[STATS] Utilisation du cache local: ${totalGuilds} serveurs, ${totalMembersAllGuilds} membres`,
      );
    }

    const memoryUsed = process.memoryUsage();
    const memoryUsageInMB = Math.round(memoryUsed.heapUsed / 1024 / 1024);
    const memoryUsage = `${memoryUsageInMB} MB`;
    let totalLines = 0;
    try {
      const isWindows = process.platform === 'win32';

      let output;
      if (isWindows) {
        try {
          output = execSync(
            'powershell -Command "(Get-ChildItem -Path . -Recurse -Include *.js | Where-Object { $_.FullName -notlike \'*node_modules*\' } | Get-Content | Measure-Object -Line).Lines"',
            {
              encoding: 'utf8',
              cwd: path.join(__dirname, '..'),
              timeout: 10000,
              stdio: ['pipe', 'pipe', 'ignore'],
            },
          );
          const parsed = parseInt((output || '').toString().trim(), 10);
          if (!Number.isNaN(parsed)) totalLines = parsed;
        } catch {
          totalLines = clusterData.totalLines || 50000;
          console.warn(
            `[STATS] PowerShell command failed, using cached value: ${totalLines}`,
          );
        }
      } else {
        output = execSync(
          'find . -name "*.js" -not -path "./node_modules/*" | xargs wc -l',
          {
            encoding: 'utf8',
            cwd: path.join(__dirname, '..'),
            timeout: 5000,
          },
        );
        const lines = output.split('\n');
        const totalLine = lines[lines.length - 2] || lines[lines.length - 1];
        if (totalLine) {
          const match = totalLine.match(/(\d+)\s+total/);
          if (match) {
            totalLines = parseInt(match[1], 10);
          }
        }
      }
    } catch {
      totalLines = clusterData.totalLines || 50000;
      console.warn(
        `[STATS] Line counting failed, using fallback value: ${totalLines}`,
      );
    }

    let shardCount = 1;
    if (client && client.shard && Array.isArray(client.shard.ids)) {
      shardCount = client.shard.count || client.shard.ids.length || 1;
    }

    const scaledMembers = Math.round(
      totalMembersAllGuilds * Math.sqrt(shardCount),
    );

    clusterData.totalServeurs = totalGuilds;
    clusterData.totalMembers = scaledMembers;
    clusterData.memoryUsage = memoryUsage;
    clusterData.totalLines = totalLines;
    clusterData.lastUpdate = Date.now();

    await fs.promises.writeFile(
      statsPath,
      JSON.stringify(clusterData, null, 2),
    );

    return {
      totalMembers: clusterData.totalMembers,
      totalGuilds: totalGuilds,
      memoryUsage,
      totalLines,
    };
  } catch (error) {
    console.error(
      '[STATS] Erreur lors de la mise à jour des statistiques:',
      error,
    );
    return null;
  }
}

async function initializeStats(client) {
  const result = await updateClusterStats(client);
  if (result) {
    return result;
  } else {
    return null;
  }
}

export { initializeStats, updateClusterStats };

