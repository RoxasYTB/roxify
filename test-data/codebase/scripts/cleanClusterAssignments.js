import fs from 'fs';
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

function safeJsonStringify(data, fallback = '{}') {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return fallback;
  }
}

function safeFileRead(filePath, fallback = '{}') {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) {
      return fallback;
    }
    return content;
  } catch {
    return fallback;
  }
}

function safeFileWrite(filePath, content) {
  try {
    fs.writeFileSync(filePath, content);
    return true;
  } catch {
    return false;
  }
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

function cleanClusterAssignments() {
  const clustersDir = path.join(__dirname, '../clusters');

  if (!fs.existsSync(clustersDir)) {
    try {
      fs.mkdirSync(clustersDir, { recursive: true });
    } catch (error) {
      console.log(
        '❌ Erreur lors de la création du dossier clusters:',
        error.message,
      );
      return;
    }
  }

  const clusterFiles = fs
    .readdirSync(clustersDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  const shardsDir = path.join(__dirname, '../shards');
  let shouldMigrate = false;

  if (fs.existsSync(shardsDir) && clusterFiles.length === 0) {
    const shardFiles = fs
      .readdirSync(shardsDir)
      .filter((file) => file.endsWith('.json'));

    if (shardFiles.length > 0) {
      shouldMigrate = true;

      for (const shardFile of shardFiles) {
        const shardId = shardFile.split('.')[0].replace('shard-', '');
        const clusterFile = `cluster-${shardId}.json`;

        const sourcePath = path.join(shardsDir, shardFile);
        const destPath = path.join(clustersDir, clusterFile);

        try {
          const content = fs.readFileSync(sourcePath, 'utf8');
          fs.writeFileSync(destPath, content);
        } catch {}
      }

      clusterFiles.push(
        ...fs
          .readdirSync(clustersDir)
          .filter((file) => file.endsWith('.json'))
          .sort(),
      );
    }
  }

  if (clusterFiles.length === 0) {
    console.log(
      'Aucun fichier de cluster trouvé, création du cluster par défaut...',
    );
    const defaultClusterFile = path.join(clustersDir, 'cluster-0.json');
    safeFileWrite(defaultClusterFile, safeJsonStringify({}));
    clusterFiles.push('cluster-0.json');
  }

  const allGuilds = new Set();
  const currentAssignments = new Map();
  const duplicates = [];

  for (const file of clusterFiles) {
    const clusterId = file.split('.')[0].replace('cluster-', '');
    const filePath = path.join(clustersDir, file);
    const fileContent = safeFileRead(filePath);
    const data = safeJsonParse(fileContent);

    console.log(
      `📊 Cluster ${clusterId}: ${Object.keys(data).length} serveurs`,
    );

    for (const guildId of Object.keys(data)) {
      if (allGuilds.has(guildId)) {
        duplicates.push({
          guildId,
          previousCluster: currentAssignments.get(guildId),
          currentCluster: clusterId,
        });
        console.log(
          `⚠️  Doublon détecté: serveur ${guildId} dans clusters ${currentAssignments.get(guildId)} et ${clusterId}`,
        );
      } else {
        allGuilds.add(guildId);
        currentAssignments.set(guildId, clusterId);
      }
    }
  }

  const availableClusters = clusterFiles
    .map((file) => file.split('.')[0].replace('cluster-', ''))
    .sort((a, b) => parseInt(a) - parseInt(b));

  const newAssignments = new Map();

  for (const guildId of allGuilds) {
    const hash = simpleHash(guildId);
    const clusterIndex = hash % availableClusters.length;
    const assignedClusterId = availableClusters[clusterIndex];

    if (!newAssignments.has(assignedClusterId)) {
      newAssignments.set(assignedClusterId, []);
    }
    newAssignments.get(assignedClusterId).push(guildId);
  }

  for (const file of clusterFiles) {
    const filePath = path.join(clustersDir, file);
    safeFileWrite(filePath, safeJsonStringify({}));
  }

  for (const [clusterId, guildIds] of newAssignments) {
    const clusterData = {};
    for (const guildId of guildIds) {
      clusterData[guildId] = true;
    }

    const filePath = path.join(clustersDir, `cluster-${clusterId}.json`);
    safeFileWrite(filePath, safeJsonStringify(clusterData));

    console.log(
      `✅ Cluster ${clusterId}: ${guildIds.length} serveurs assignés`,
    );
  }

  if (duplicates.length > 0) {
    duplicates.forEach(({ guildId, previousCluster, currentCluster }) => {
      const hash = simpleHash(guildId);
      const correctCluster = availableClusters[hash % availableClusters.length];
      console.log(
        `   - Serveur ${guildId}: était dans clusters ${previousCluster} et ${currentCluster}, maintenant dans cluster ${correctCluster}`,
      );
    });
  }

  if (shouldMigrate) {
    console.log(
      '\n🔄 Migration terminée ! Les anciens fichiers shards sont conservés pour sauvegarde.',
    );
    console.log(
      '   Vous pouvez supprimer le dossier "shards" manuellement après vérification.',
    );
  }

  const verification = verifyAssignments();
  if (verification.valid) {
    console.log(
      '✅ Toutes les assignations sont maintenant uniques et cohérentes !',
    );
  } else {
  }
}

function verifyAssignments() {
  try {
    const clustersDir = path.join(__dirname, '../clusters');
    const clusterFiles = fs
      .readdirSync(clustersDir)
      .filter((file) => file.endsWith('.json'));

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

if (require.main === module) {
  cleanClusterAssignments();
}

export { cleanClusterAssignments, verifyAssignments };

