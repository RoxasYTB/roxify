import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeJsonParse(content, fallback = {}) {
  try {
    if (!content || !content.trim()) {
      return fallback;
    }
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

function safeFileRead(filePath, fallback = '{}') {
  try {
    const content = readFileSync(filePath, 'utf8');
    if (!content.trim()) {
      return fallback;
    }
    return content;
  } catch {
    return fallback;
  }
}

function checkShards() {
  return true;
}

function getGuildClusterAssignment(guildId) {
  try {
    const clustersDir = path.join(__dirname, '../clusters');
    if (!existsSync(clustersDir)) {
      return null;
    }

    const clusterFiles = readdirSync(clustersDir).filter((file) =>
      file.endsWith('.json'),
    );

    for (const file of clusterFiles) {
      const filePath = path.join(clustersDir, file);
      const fileContent = safeFileRead(filePath);
      const data = safeJsonParse(fileContent);

      if (data[guildId]) {
        return file.split('.')[0].replace('cluster-', '');
      }
    }

    const availableClusters = clusterFiles
      .map((file) => file.split('.')[0].replace('cluster-', ''))
      .sort((a, b) => parseInt(a) - parseInt(b));

    if (availableClusters.length === 0) {
      return '0';
    }

    function simpleHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    }

    const hash = simpleHash(guildId);
    const clusterIndex = hash % availableClusters.length;
    return availableClusters[clusterIndex];
  } catch {
    return null;
  }
}

function validateClusterAssignments() {
  try {
    const clustersDir = path.join(__dirname, '../clusters');
    if (!existsSync(clustersDir)) {
      return { valid: true, message: 'Aucun fichier de cluster trouvé' };
    }

    const clusterFiles = readdirSync(clustersDir).filter((file) =>
      file.endsWith('.json'),
    );

    const guildAssignments = new Map();
    const duplicates = [];

    for (const file of clusterFiles) {
      const clusterId = file.split('.')[0].replace('cluster-', '');
      const filePath = path.join(clustersDir, file);
      const fileContent = safeFileRead(filePath);
      const data = safeJsonParse(fileContent);

      for (const guildId of Object.keys(data)) {
        if (guildAssignments.has(guildId)) {
          duplicates.push({
            guildId,
            clusters: [guildAssignments.get(guildId), clusterId],
          });
        } else {
          guildAssignments.set(guildId, clusterId);
        }
      }
    }

    return {
      valid: duplicates.length === 0,
      duplicates,
      totalGuilds: guildAssignments.size,
      totalClusters: clusterFiles.length,
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export {
  checkShards,
  getGuildClusterAssignment,
  getGuildClusterAssignment as getGuildShardAssignment,
  validateClusterAssignments,
  validateClusterAssignments as validateShardAssignments,
};

export default {
  checkShards,
  getGuildClusterAssignment,
  validateClusterAssignments,

  getGuildShardAssignment: getGuildClusterAssignment,
  validateShardAssignments: validateClusterAssignments,
};

