import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { promises as fsPromises, readdirSync } from 'fs';
import { createRequire } from 'node:module';
import path from 'path';
import { fileURLToPath } from 'url';
import loadEnv from './config/loadEnv.js';
import getDiscordToken from './config/tokenHandler.js';
import setupUserapp from './services/userapp.js';
import setupVoice from './services/voice.js';
import { cacheGet, cacheSet } from './utils/coreUtils.js';
import { getSelectedModel } from './utils/voice/modelStore.js';

const require = createRequire(import.meta.url);
const voice = require('./voice-wrapper.cjs');
const {
  joinVoiceChannel,
  getVoiceConnection,
  addSpeechEvent,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = voice;

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_BOT = getDiscordToken();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
    Partials.Reaction,
  ],

  ws: {
    large_threshold: 25,
    compress: true,
    properties: {
      browser: 'discord.js',
    },
  },
  retryLimit: 2,
  maxListeners: 10,
});

const handleSpeechEvent = async (msg) => {
  try {
    if (!msg || msg.author.bot) return;
    if (!msg.content) {
      let errorDetail = msg?.error;
      if (errorDetail) {
        if (errorDetail instanceof Error) {
          errorDetail = `${errorDetail.name}: ${errorDetail.message}${errorDetail.cause ? ` (Cause: ${errorDetail.cause.message})` : ''}`;
        } else if (typeof errorDetail === 'object') {
          try {
            errorDetail = JSON.stringify(errorDetail, null, 2);
          } catch {
            errorDetail = String(errorDetail);
          }
        } else {
          errorDetail = String(errorDetail);
        }
      } else {
        errorDetail = 'Erreur inconnue';
      }

      return;
    }
    if (msg.content.toLowerCase().includes('glados')) {
      const channel = msg.member?.voice?.channel;
      if (!channel) return;
      let connection = getVoiceConnection(msg.guild.id);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: msg.guild.id,
          adapterCreator: msg.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false,
        });
        try {
          if (typeof client.__gladosRegisterVoiceConnection === 'function') {
            client.__gladosRegisterVoiceConnection(connection);
          }
        } catch {}
        connection.receiver.speaking.on('start', (_userId) => {});
        try {
          connection.on('error', (err) => {
            console.error('[BOT] Voice connection unhandled error:', err);
            try {
              connection.destroy();
            } catch {}
          });
          const udpSock =
            connection.udp ||
            connection._udp ||
            connection.udpSocket ||
            connection.socket;
          if (udpSock && typeof udpSock.on === 'function') {
            udpSock.on('error', (err) => {
              console.error('[BOT] Voice UDP socket error:', err);
              try {
                connection.destroy();
              } catch {}
            });
          }
        } catch {}
      }

      const waitForReady = (conn) =>
        new Promise((resolve, reject) => {
          if (conn.state.status === 'ready') {
            resolve();
          } else {
            const timeout = setTimeout(
              () => reject(new Error('Connection timeout')),
              5000,
            );
            conn.once('stateChange', (oldState, newState) => {
              if (newState.status === 'ready') {
                clearTimeout(timeout);
                resolve();
              }
            });
          }
        });

      try {
        await waitForReady(connection);
      } catch (err) {
        console.warn('[BOT] Timeout attente connexion:', err.message);
      }

      const playBoup = async () => {
        try {
          const { existsSync } = await import('fs');
          const boupPath = path.join(process.cwd(), 'assets', 'boup.mp3');

          if (!existsSync(boupPath)) {
            return;
          }

          const boupPlayer = createAudioPlayer();
          const boupResource = createAudioResource(boupPath);

          boupPlayer.on('error', (_err) => {});

          connection.subscribe(boupPlayer);
          boupPlayer.play(boupResource);

          await new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
              resolve();
            }, 3000);
            boupPlayer.once(AudioPlayerStatus.Idle, () => {
              clearTimeout(timeoutId);
              resolve();
            });
          });
        } catch (err) {
          console.error(
            '[BOT] Erreur lors de la lecture du boup:',
            err.message,
          );
        }
      };

      await playBoup();
      try {
        const fetch = (...args) =>
          import('node-fetch').then(({ default: fetch }) => fetch(...args));
        const response = await fetch('http://localhost:6259/glados-min', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: `${msg.author.username} : ${msg.content}`,
          }),
        }).then((r) => r.json());
        const aiResponse = response?.response || "Je n'ai pas compris.";

        const isMaexxna = (guild) => {
          try {
            const displayName = guild?.members?.me?.displayName;
            return (
              (displayName && displayName.toLowerCase().includes('maexxna')) ||
              (client.user?.username &&
                client.user.username.toLowerCase().includes('maexxna'))
            );
          } catch {
            return (
              client.user?.username &&
              client.user.username.toLowerCase().includes('maexxna')
            );
          }
        };
        if (isMaexxna(msg.guild)) {
          try {
            const ttsModule = await import('./utils/voice/ttsManager.js');
            const { ttsResponse, generateMaexxnaFile } = ttsModule;
            if (typeof ttsResponse === 'function') {
              console.log('[SPEECH] Appel ttsResponse (Maexxna)');
              await ttsResponse(connection, aiResponse);
            } else if (typeof generateMaexxnaFile === 'function') {
              console.log('[SPEECH] Appel generateMaexxnaFile');
              const filePath = path.join(
                process.cwd(),
                'audio_out_' + Date.now() + '.mp3',
              );

              await generateMaexxnaFile(aiResponse, filePath);
              await new Promise((resolve) => setTimeout(resolve, 500));

              const resource = createAudioResource(filePath, {
                inputType: 'arbitrary',
              });
              const player = createAudioPlayer();
              connection.subscribe(player);
              player.play(resource);
              player.on(AudioPlayerStatus.Idle, () => {
                try {
                  fs.unlinkSync(filePath);
                } catch {}
              });
            } else {
              console.log(
                '[SPEECH] ⚠️ Ni ttsResponse ni generateMaexxnaFile disponibles',
              );
            }
          } catch (err) {
            console.error(
              '[SPEECH] Erreur ttsResponse/generateMaexxnaFile:',
              err.message,
            );
          }
        } else {
          try {
            const ttsModule = await import('./utils/voice/ttsManager.js');
            const { generateWithPiper } = ttsModule;
            const filePath = path.join(
              process.cwd(),
              'audio_out_' + Date.now() + '.mp3',
            );

            const selectedModel = getSelectedModel(msg.guild.id);
            await generateWithPiper(aiResponse, filePath, {
              language: 'fr',
              modelName: selectedModel || null,
            });
            await new Promise((resolve) => setTimeout(resolve, 500));

            const resource = createAudioResource(filePath, {
              inputType: 'arbitrary',
            });
            const player = createAudioPlayer();
            connection.subscribe(player);
            player.play(resource);
            player.on(AudioPlayerStatus.Idle, () => {
              try {
                fs.unlinkSync(filePath);
              } catch {}
            });
          } catch (err) {
            console.error('[SPEECH] Erreur generateWithPiper:', err.message);
          }
        }
      } catch {}
    }
  } catch {}
};

client.on('speech', handleSpeechEvent);

client.on('voiceJoin', (_connection) => {});

client.on('voiceLeave', (_connection) => {});

try {
  if (addSpeechEvent && typeof addSpeechEvent === 'function') {
    addSpeechEvent(client, { lang: 'fr-FR' });
  } else {
  }
} catch (err) {
  console.error(
    "[BOT] ❌ Erreur lors de l'initialisation de discord-speech-recognition:",
    err.message,
  );
}

try {
  try {
    require('sodium-native');
  } catch {
    try {
      require('libsodium-wrappers');
    } catch (fallbackErr) {
      console.warn(
        '[BOT] libsodium-wrappers non disponible:',
        fallbackErr.message,
      );
    }
  }
  try {
    require('crypto');
  } catch {}
} catch (err) {
  console.warn(
    '[BOT] Vérification des backends crypto a rencontré une erreur:',
    err.message,
  );
}

client.on('error', (error) => {
  if (
    error.message === 'Authentication failed' ||
    error.message.includes('Authentication failed') ||
    error.message.includes('Invalid token') ||
    error.message.includes('401: Unauthorized')
  ) {
    console.error(
      "🚨 [CLIENT] Erreur d'authentification Discord:",
      error.message,
    );
    console.error('📋 Vérifiez que votre token Discord est valide et actif');
    return;
  }

  console.error('[CLIENT] Erreur du client Discord:', error.message);
});

client.on('shardError', (error, shardId) => {
  if (
    error.message === 'Authentication failed' ||
    error.message.includes('Authentication failed') ||
    error.message.includes('Invalid token')
  ) {
    console.error(
      `🚨 [SHARD] Erreur d'authentification sur le shard ${shardId}:`,
      error.message,
    );
    console.error('📋 Vérifiez que votre token Discord est valide et actif');
    return;
  }

  console.error(`[SHARD] Erreur sur le shard ${shardId}:`, error.message);
});

client.on('disconnect', () => {
  return;
});

client.on('reconnecting', () => {
  return;
});

process.on('exit', () => {
  console.log("🛑 [PROCESS] Processus en cours d'arrêt...");
});

process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(
    '[PROCESS] Unhandled rejection at:',
    promise,
    'reason:',
    reason,
  );
});

const eventsDir = path.join(__dirname, 'events');
const eventFiles = readdirSync(eventsDir).filter((file) =>
  file.endsWith('.js'),
);

async function addGuildToShardFile(guildId, shardId) {
  const cacheKey = `shard_guilds_${shardId}`;
  let data = cacheGet(cacheKey);
  if (!data) {
    const shardsDir = path.join(__dirname, 'shards');
    const filePath = path.join(shardsDir, `shard-${shardId}.json`);
    data = {};
    try {
      await fsPromises.access(filePath);
      const fileContent = await fsPromises.readFile(filePath, 'utf8');
      data = JSON.parse(fileContent);
    } catch {
      data = {};
    }
    cacheSet(cacheKey, data, 300000);
  }
  if (!data[guildId]) {
    data[guildId] = true;
    cacheSet(cacheKey, data, 300000);

    const shardsDir = path.join(__dirname, 'shards');
    const filePath = path.join(shardsDir, `shard-${shardId}.json`);
    fsPromises
      .writeFile(filePath, JSON.stringify(data, null, 2))
      .catch(() => {});
  }
}

const registeredEvents = new Set();

(async () => {
  for (const file of eventFiles) {
    try {
      const event = await import(`./events/${file}`);

      if (
        !event?.name ||
        !event?.execute ||
        typeof event.execute !== 'function'
      ) {
        console.warn(`⚠️ Événement invalide ignoré: ${file}`);
        continue;
      }

      if (registeredEvents.has(event.name)) {
        console.warn(
          `⚠️ Événement ${event.name} déjà enregistré, ignoré pour éviter les doublons`,
        );
        continue;
      }

      const eventHandler = (...args) => {
        const shardId = client.shard?.ids?.[0] || 0;
        try {
          if (event.name === 'guildCreate') {
            const guild = args[0];
            addGuildToShardFile(guild.id, shardId);
          }
          event.execute(...args, shardId);
        } catch (error) {
          console.error(
            `❌ Erreur lors de l'exécution de l'événement ${event.name}:`,
            error.message,
          );
        }
      };

      if (event.name === 'clientReady') {
        client.once(event.name, eventHandler);
      } else {
        client.on(event.name, eventHandler);
      }

      registeredEvents.add(event.name);
    } catch (error) {
      console.error(`❌ Erreur lors du chargement de ${file}:`, error.message);
    }
  }
})();

try {
  await setupVoice(client);
} catch {}

try {
  await setupUserapp(client);
} catch {}

client.once('clientReady', () => {
  const shardId = client.shard?.ids?.[0] || 0;
  setImmediate(() => {
    client.guilds.cache.forEach((guild) => {
      addGuildToShardFile(guild.id, shardId);
    });
  });
  if (process.send) {
    process.send({ type: 'ready' });
  }
});

async function loginWithRetry(maxRetries = 3, baseDelay = 10000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const loginPromise = client.login(TOKEN_BOT);
      const timeoutDuration = 30000 + (attempt - 1) * 15000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Login timeout')), timeoutDuration);
      });

      await Promise.race([loginPromise, timeoutPromise]);
      return;
    } catch (error) {
      if (
        error.message === 'Authentication failed' ||
        error.message.includes('Authentication failed') ||
        error.message.includes('Invalid token') ||
        error.message.includes('401: Unauthorized')
      ) {
        console.error(
          "🚨 Erreur d'authentification lors de la connexion:",
          error.message,
        );
        console.error(
          '📋 Vérifiez que votre token Discord est valide et actif',
        );
        console.error("❌ Arrêt du bot en raison d'un token invalide");
        process.exit(1);
      }

      console.error(`❌ Tentative ${attempt} échouée:`, error.message);
      if (attempt === maxRetries) {
        console.error('❌ Toutes les tentatives de connexion ont échoué');
        process.exit(1);
      }

      const delay = baseDelay * attempt;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

loginWithRetry().catch((error) => {
  console.error('❌ Erreur critique lors de la connexion:', error.message);
  process.exit(1);
});

export default client;
