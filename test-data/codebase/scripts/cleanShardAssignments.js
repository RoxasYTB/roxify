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

function cleanShardAssignments() {
  const shardsDir = path.join(__dirname, '../shards');

  if (!fs.existsSync(shardsDir)) {
    return;
  }

  const shardFiles = fs
    .readdirSync(shardsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  if (shardFiles.length === 0) {
    return;
  }

  const allGuilds = new Set();
  const currentAssignments = new Map();
  const duplicates = [];

  for (const file of shardFiles) {
    const shardId = file.split('.')[0].replace('shard-', '');
    const filePath = path.join(shardsDir, file);
    const fileContent = safeFileRead(filePath);
    const data = safeJsonParse(fileContent);

    for (const guildId of Object.keys(data)) {
      if (allGuilds.has(guildId)) {
        duplicates.push({
          guildId,
          previousShard: currentAssignments.get(guildId),
          currentShard: shardId,
        });
        console.log(
          `⚠️  Doublon détecté: serveur ${guildId} dans shards ${currentAssignments.get(guildId)} et ${shardId}`,
        );
      } else {
        allGuilds.add(guildId);
        currentAssignments.set(guildId, shardId);
      }
    }
  }

  const availableShards = shardFiles
    .map((file) => file.split('.')[0].replace('shard-', ''))
    .sort((a, b) => parseInt(a) - parseInt(b));

  const newAssignments = new Map();

  for (const guildId of allGuilds) {
    const hash = simpleHash(guildId);
    const shardIndex = hash % availableShards.length;
    const assignedShardId = availableShards[shardIndex];

    if (!newAssignments.has(assignedShardId)) {
      newAssignments.set(assignedShardId, []);
    }
    newAssignments.get(assignedShardId).push(guildId);
  }

  for (const file of shardFiles) {
    const filePath = path.join(shardsDir, file);
    safeFileWrite(filePath, safeJsonStringify({}));
  }

  for (const [shardId, guildIds] of newAssignments) {
    const shardData = {};
    for (const guildId of guildIds) {
      shardData[guildId] = true;
    }

    const filePath = path.join(shardsDir, `shard-${shardId}.json`);
    safeFileWrite(filePath, safeJsonStringify(shardData));
  }

  if (duplicates.length > 0) {
    duplicates.forEach(({ guildId, previousShard, currentShard }) => {
      const hash = simpleHash(guildId);
      const correctShard = availableShards[hash % availableShards.length];
      console.log(
        `   - Serveur ${guildId}: était dans shards ${previousShard} et ${currentShard}, maintenant dans shard ${correctShard}`,
      );
    });
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
    const shardsDir = path.join(__dirname, '../shards');
    const shardFiles = fs
      .readdirSync(shardsDir)
      .filter((file) => file.endsWith('.json'));

    const guildAssignments = new Map();
    const duplicates = [];

    for (const file of shardFiles) {
      const shardId = file.split('.')[0].replace('shard-', '');
      const filePath = path.join(shardsDir, file);
      const fileContent = safeFileRead(filePath);
      const data = safeJsonParse(fileContent);

      for (const guildId of Object.keys(data)) {
        if (guildAssignments.has(guildId)) {
          duplicates.push({
            guildId,
            shards: [guildAssignments.get(guildId), shardId],
          });
        } else {
          guildAssignments.set(guildId, shardId);
        }
      }
    }

    return {
      valid: duplicates.length === 0,
      duplicates,
      totalGuilds: guildAssignments.size,
      totalShards: shardFiles.length,
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

if (require.main === module) {
  cleanShardAssignments();
}

export { cleanShardAssignments, verifyAssignments };

