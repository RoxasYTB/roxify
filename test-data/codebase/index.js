import { ShardingManager } from 'discord.js';
import { existsSync, writeFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import loadEnv from './config/loadEnv.js';
import getDiscordToken from './config/tokenHandler.js';
loadEnv();

import { updateServersJson } from './utils/dotCommands/handleScoreboardCommand.js';
import {
  ensureDirectoryExists,
  getJsFilesRecursively,
} from './utils/fileHelper.js';
import { colors, logHeader, logMessage } from './utils/logger.js';
import triggerErrorEmbed from './utils/triggerErrorEmbed.js';
import { cleanupRootAudioOutFiles } from './utils/voice/fileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { checkForChanges } from './checkForChanges.js';
setInterval(checkForChanges, 5000);

await ensureDirectoryExists('./shards');

const shardsDir = path.join(__dirname, 'shards');
await ensureDirectoryExists(shardsDir);

(async () => {
  try {
    const files = await fs.readdir(shardsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    if (jsonFiles.length > 0) {
      await Promise.all(
        jsonFiles.map((file) => fs.unlink(path.join(shardsDir, file))),
      );
    }
  } catch (err) {
    console.error('Erreur lors du nettoyage des shards:', err);
  }
})();

try {
  cleanupRootAudioOutFiles().catch(() => {});
} catch {}

setInterval(() => {
  try {
    cleanupRootAudioOutFiles().catch(() => {});
  } catch {}
}, 60 * 1000);

const totalShards = 'auto';

const memoryLimit = process.env.SHARD_MEMORY_LIMIT || '256';

const manager = new ShardingManager('./bot.js', {
  totalShards,
  token: getDiscordToken(),
  respawn: true,
  execArgv: [
    `--max-old-space-size=${memoryLimit}`,
    '--gc-interval=100',
    '--optimize-for-size',
  ],
  shardArgs: [`--memory-limit=${memoryLimit}`, '--optimize-cache=true'],
  timeout: 60000,
  shardDelay: 5000,
  env: {
    ...process.env,
  },
});

manager.on('error', (error) => {
  const message = error && error.message ? error.message : '';

  if (error.code === 'ShardingReadyTimeout') {
    console.error(
      '⚠️ [MANAGER] Timeout détecté au niveau manager - redémarrage automatique...',
    );
    return;
  }

  if (
    message === 'Authentication failed' ||
    message.includes('Authentication failed') ||
    message.includes('Invalid token')
  ) {
    console.error(
      "🚨 [MANAGER] Erreur d'authentification du ShardingManager:",
      message,
    );
    console.error('📋 Vérifiez que votre token Discord est valide et actif');
    return;
  }

  console.error('[MANAGER] Erreur du ShardingManager:', message);
  triggerErrorEmbed(error, {
    action: 'shardManagerError',
    component: 'index',
  });
});

logHeader('deployCommandsTitle');

['commands', 'events', 'utils', 'interactions'].forEach((dir) =>
  getJsFilesRecursively(`./${dir}/`, dir),
);

logMessage('loadingAI', colors.BRIGHT_CYAN);
logMessage('successAI', colors.BRIGHT_GREEN);
logMessage('connectingBot', colors.BRIGHT_YELLOW);
logMessage('successBot', colors.BRIGHT_GREEN);
logMessage('loadingShards', colors.BRIGHT_YELLOW);

manager.on('shardCreate', (shard) => {
  try {
    shard.on('ready', () => {
      console.log(
        `\x1b[1m\x1b[31m[SHARD]\x1b[0m Shard ${shard.id} chargé avec succès!`,
      );
      const shardsDir = path.join(__dirname, 'shards');
      ensureDirectoryExists(shardsDir);
      const shardIdFilePath = path.join(shardsDir, `shard-${shard.id}.json`);
      if (!existsSync(shardIdFilePath)) {
        writeFileSync(shardIdFilePath, JSON.stringify({}, null, 2));
      }
    });

    shard.on('error', (error) => {
      const message = error && error.message ? error.message : '';

      if (error.code === 'ShardingReadyTimeout') {
        setTimeout(() => {
          shard
            .respawn({ delay: 5000, timeout: 180000 })
            .then(() => {
              console.log(
                `✅ [SHARD ${shard.id}] Shard redémarré avec succès après timeout`,
              );
            })
            .catch((respawnError) => {
              console.error(
                `❌ [SHARD ${shard.id}] Erreur lors du redémarrage:`,
                respawnError.message,
              );

              setTimeout(() => {
                shard.respawn({ delay: 10000, timeout: 180000 }).catch(() => {
                  console.error(
                    `💀 [SHARD ${shard.id}] Impossible de redémarrer le shard - abandon`,
                  );
                });
              }, 15000);
            });
        }, 2000);
        return;
      }

      if (
        message === 'Authentication failed' ||
        message.includes('Authentication failed') ||
        message.includes('Invalid token')
      ) {
        console.error(
          `🚨 [SHARD ${shard.id}] Erreur d'authentification:`,
          message,
        );
        console.error(
          '📋 Vérifiez que votre token Discord est valide et actif',
        );
        console.error(
          '🔄 Le shard va tenter de se reconnecter automatiquement...',
        );
        return;
      }

      console.error(`[SHARD ${shard.id}] Erreur:`, message);
      triggerErrorEmbed(error, {
        action: 'shardError',
        shardId: shard.id,
        component: 'index',
      });
    });
    shard.on('disconnect', () => {
      setTimeout(() => {
        if (shard.process && !shard.process.connected) {
          console.log(
            `[SHARD ${shard.id}] Tentative de respawn du shard déconnecté...`,
          );
          shard.respawn({ delay: 5000, timeout: 180000 });
        }
      }, 10000);
    });

    shard.on('death', () => {
      console.error(
        `[SHARD ${shard.id}] Mort du shard - Respawn automatique activé`,
      );
    });

  } catch (error) {
    console.error(
      `[SHARD ${shard.id}] Erreur lors de la création du shard:`,
      error,
    );
    triggerErrorEmbed(error, {
      action: 'shardCreateError',
      shardId: shard.id,
      component: 'index',
    });
  }
});
manager
  .spawn({
    timeout: 180000,
    delay: 5000,
  })
  .catch((error) => {
    const message = error && error.message ? error.message : '';

    if (error.code === 'ShardingReadyTimeout') {
      console.error(
        '⚠️ Timeout lors du spawn des shards - le bot continue de fonctionner',
      );
      console.error(
        '🔄 Les shards vont tenter de redémarrer automatiquement...',
      );

      manager.shards.forEach((shard) => {
        if (!shard.ready) {
          setTimeout(() => {
            shard
              .respawn({ delay: 5000, timeout: 180000 })
              .then(() => {})
              .catch((respawnError) => {
                console.error(
                  `❌ Erreur lors du redémarrage du shard ${shard.id}:`,
                  respawnError.message,
                );
              });
          }, shard.id * 5000);
        }
      });
      return;
    }

    if (
      message === 'Authentication failed' ||
      message.includes('Authentication failed') ||
      message.includes('Invalid token') ||
      message.includes('401: Unauthorized')
    ) {
      console.error(
        "🚨 Erreur d'authentification lors du spawn des shards:",
        message,
      );
      console.error('📋 Vérifiez que votre token Discord est valide et actif');
      console.error('❌ Impossible de démarrer le bot avec un token invalide');
      process.exit(1);
    }

    console.error('❌ Erreur lors du spawn des shards:', error);
    console.error('🔄 Le bot va continuer à essayer de se connecter...');
    triggerErrorEmbed(error, {
      action: 'shardSpawnError',
      component: 'index',
    });

    setTimeout(() => {
      manager
        .spawn({
          timeout: 180000,
          delay: 5000,
        })
        .catch(() => {
          console.error(
            '💀 Impossible de redémarrer les shards - arrêt du bot',
          );
          process.exit(1);
        });
    }, 30000);
  });

setInterval(() => {
  if (manager && manager.shards && manager.shards.size > 0) {
    const firstShard = manager.shards.values().next().value;
    if (firstShard && firstShard.process) {
      if (global.client) {
        updateServersJson(global.client);
      }
    }
  }
}, 60000);

setInterval(() => {
  if (manager && manager.shards && manager.shards.size > 0) {
    const firstShard = manager.shards.values().next().value;
    if (firstShard && firstShard.process) {
      firstShard
        .send({
          type: 'updateStats',
          data: {},
        })
        .catch(() => {
          console.error('Erreur lors de la demande de mise à jour des stats');
        });
    }
  }
}, 20000);


