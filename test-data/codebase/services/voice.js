import fs from 'fs';
import { createRequire } from 'node:module';
import path from 'path';
import {
  cleanupAudioFiles,
  cleanupRootAudioOutFiles,
} from '../utils/voice/fileManager.js';
import {
  getSelectedModel,
  setSelectedModel,
} from '../utils/voice/modelStore.js';
import {
  generateMaexxnaFile,
  generateWithPiper,
  ttsResponse,
} from '../utils/voice/ttsManager.js';
const require = createRequire(import.meta.url);
const voice = require(path.join(process.cwd(), 'voice-wrapper.cjs'));
const {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  joinVoiceChannel,
} = voice;

export default async function init(client) {
  const voiceConnections = new Map();
  const reconnectAttempts = new Map();
  const joinConfigs = new Map();
  const activeStreamsByGuild = new Map();

  if (!global.__gladosVoiceExceptionHandler) {
    global.__gladosVoiceExceptionHandler = true;
    process.on('uncaughtException', (err) => {
      try {
        if (
          String(err?.message || '').includes('DAVE') ||
          String(err?.message || '').includes('DAVESession')
        ) {
          console.error(
            '[VOICE SERVICE] Uncaught DAVE error detected — cleaning up voice connections',
            err.message,
          );
          for (const [g, conn] of voiceConnections.entries()) {
            try {
              conn.destroy();
            } catch {}
            voiceConnections.delete(g);
          }
        }
      } catch {}
    });
  }
  if (!global.__gladosVoiceRejectionHandler) {
    global.__gladosVoiceRejectionHandler = true;
    process.on('unhandledRejection', (reason) => {
      try {
        if (
          String(reason?.message || '').includes('DAVE') ||
          String(reason).includes('DAVESession')
        ) {
          console.error(
            '[VOICE SERVICE] Unhandled rejection with DAVE: cleaning up voice connections',
            String(reason),
          );
          for (const [g, conn] of voiceConnections.entries()) {
            try {
              conn.destroy();
            } catch {}
            voiceConnections.delete(g);
          }
        }
      } catch {}
    });
  }

  function tryAttachVoiceHandlers(connection, guildId) {
    if (!connection) return;
    try {
      const safeDestroy = (label, err) => {
        console.error(`[VOICE SERVICE] ${label}:`, String(err));
        try {
          const joinCfg = connection.joinConfig || null;
          connection.destroy();
          voiceConnections.delete(guildId);
          if (joinCfg) {
            const attempts = reconnectAttempts.get(guildId) || 0;
            if (attempts >= 3) {
              console.warn(
                '[VOICE SERVICE] Reconnect attempts exceeded for guild',
                guildId,
              );
            } else {
              reconnectAttempts.set(guildId, attempts + 1);
              setTimeout(() => {
                try {
                  const newConn = joinVoiceChannel(joinCfg);
                  voiceConnections.set(guildId, newConn);
                  newConn.on('destroy', () => {
                    voiceConnections.delete(guildId);
                    activeStreamsByGuild.delete(guildId);
                  });
                  tryAttachVoiceHandlers(newConn, guildId);
                  reconnectAttempts.delete(guildId);
                  console.info(
                    '[VOICE SERVICE] Attempted reconnect after voice error for guild',
                    guildId,
                  );
                } catch {}
              }, 2500);
            }
            setTimeout(() => {
              try {
                const newConn = joinVoiceChannel(joinCfg);
                voiceConnections.set(guildId, newConn);
                newConn.on('destroy', () => {
                  voiceConnections.delete(guildId);
                  activeStreamsByGuild.delete(guildId);
                });
                tryAttachVoiceHandlers(newConn, guildId);
                console.info(
                  '[VOICE SERVICE] Attempted reconnect after voice error for guild',
                  guildId,
                );
              } catch {}
            }, 2500);
          }
        } catch {}
      };

      if (typeof connection.on === 'function') {
        connection.on('error', (err) =>
          safeDestroy('Voice connection error', err),
        );

        connection.on('debug', (info) => {
          try {
            console.debug(`[VOICE DEBUG ${guildId}]`, info);
          } catch {}
        });
      }

      if (connection.receiver && typeof connection.receiver.on === 'function') {
        connection.receiver.on('error', (err) =>
          safeDestroy('Voice receiver error', err),
        );

        if (
          connection.receiver.speaking &&
          typeof connection.receiver.speaking.on === 'function'
        ) {
          connection.receiver.speaking.on('error', (err) =>
            safeDestroy('Voice speaking error', err),
          );
        }
      }

      try {
        const udpSocket =
          connection.udp ||
          connection._udp ||
          connection.udpSocket ||
          connection.socket;
        if (udpSocket && typeof udpSocket.on === 'function') {
          udpSocket.on('error', (err) =>
            safeDestroy('Voice UDP socket error', err),
          );
        }
      } catch {}
    } catch (e) {
      console.error('[VOICE SERVICE] Failed to attach voice handlers:', e);
    }
  }
  client.on('voiceJoin', (connection) => {
    try {
      if (!connection || !connection.joinConfig) return;
      registerJoinConfig(connection.joinConfig.guildId, connection.joinConfig);
      voiceConnections.set(connection.joinConfig.guildId, connection);
      connection.on('destroy', () => {
        const gid = connection.joinConfig?.guildId;
        if (gid) {
          voiceConnections.delete(gid);
          reconnectAttempts.delete(gid);
          joinConfigs.delete(gid);
          activeStreamsByGuild.delete(gid);
        }
      });
      tryAttachVoiceHandlers(connection, connection.joinConfig.guildId);
    } catch {}
  });
  client.on('shardDisconnect', () => {
    try {
      console.warn(
        '[VOICE SERVICE] Shard disconnected: cleaning voice connections',
      );
      for (const [g, conn] of voiceConnections.entries()) {
        try {
          conn.destroy();
        } catch {}
        voiceConnections.delete(g);
        reconnectAttempts.delete(g);
        activeStreamsByGuild.delete(g);
      }
    } catch {}
  });

  client.on('shardResume', (_shardId) => {
    try {
      setTimeout(async () => {
        try {
          for (const [guildId, joinCfg] of joinConfigs.entries()) {
            try {
              await attemptRejoinGuild(guildId, joinCfg);
            } catch {}
          }

          for (const [gid, guild] of client.guilds.cache) {
            try {
              const me = guild?.members?.me;
              const channelId = me?.voice?.channelId;
              if (channelId) {
                const existing = getVoiceConnection(gid);
                if (!existing) {
                  const joinCfg = {
                    channelId,
                    guildId: gid,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false,
                  };
                  await attemptRejoinGuild(gid, joinCfg);
                  registerJoinConfig(gid, joinCfg);
                }
              }
            } catch {}
          }
        } catch {}
      }, 2500);
    } catch {}
  });

  function registerJoinConfig(guildId, joinCfg) {
    try {
      if (!guildId || !joinCfg) return;
      joinConfigs.set(guildId, Object.assign({}, joinCfg));
    } catch {}
  }

  async function attemptRejoinGuild(guildId, joinCfg) {
    try {
      if (!joinCfg || !guildId) return;
      const existing = getVoiceConnection(guildId);
      if (existing) return;
      const newConn = joinVoiceChannel(joinCfg);
      voiceConnections.set(guildId, newConn);
      newConn.on('destroy', () => {
        voiceConnections.delete(guildId);
        reconnectAttempts.delete(guildId);
        activeStreamsByGuild.delete(guildId);
      });
      tryAttachVoiceHandlers(newConn, guildId);
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 2500));
        const newConn = joinVoiceChannel(joinCfg);
        voiceConnections.set(guildId, newConn);
        newConn.on('destroy', () => {
          voiceConnections.delete(guildId);
          reconnectAttempts.delete(guildId);
          activeStreamsByGuild.delete(guildId);
        });
        tryAttachVoiceHandlers(newConn, guildId);
      } catch {}
    }
  }

  const WHITELISTED = [
    '895263420646039602',
    '1167412275548790824',
    '798630183606550588',
    '188017013132623872',
    '648690939719843852',
    '1025745321525006357',
    '454682288563683329',
    '1174259316329566213',
    '194161473704951808',
    '798630183606550588',
    '1322669751876587723',
  ];

  client.on('clientReady', () => {
    setInterval(
      () => {
        try {
          cleanupAudioFiles();
        } catch {}
      },
      5 * 60 * 1000,
    );
    try {
      cleanupAudioFiles();
    } catch {}
    try {
      cleanupRootAudioOutFiles();
    } catch {}
    setInterval(() => {
      try {
        cleanupRootAudioOutFiles();
      } catch {}
    }, 60 * 1000);
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      if (!newState.member.user.bot) return;
      if (newState.member.user.id !== client.user.id) return;

      if (!oldState.channelId && newState.channelId) {
        const connection = getVoiceConnection(newState.guild.id);
        if (connection) {
          voiceConnections.set(newState.guild.id, connection);
          try {
            registerJoinConfig(
              newState.guild.id,
              connection.joinConfig || {
                channelId: newState.channelId,
                guildId: newState.guild.id,
                adapterCreator: newState.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false,
              },
            );
          } catch {}

          connection.on('destroy', () => {
            voiceConnections.delete(newState.guild.id);
            reconnectAttempts.delete(newState.guild.id);
            joinConfigs.delete(newState.guild.id);
            activeStreamsByGuild.delete(newState.guild.id);
          });

          tryAttachVoiceHandlers(connection, newState.guild.id);
          let activeStreams = activeStreamsByGuild.get(newState.guild.id);
          if (!activeStreams) {
            activeStreams = new Map();
            activeStreamsByGuild.set(newState.guild.id, activeStreams);
          }
          connection.receiver.speaking.on('start', (userId) => {
            setTimeout(() => {
              if (activeStreams.has(userId)) {
                return;
              }
              const user = client.users.cache.get(userId);
              if (user && !user.bot) {
                try {
                  const audioStream = connection.receiver.subscribe(userId, {
                    end: { behavior: 'manual' },
                  });
                  if (audioStream) {
                    activeStreams.set(userId, audioStream);
                    try {
                      if (
                        audioStream &&
                        typeof audioStream.setMaxListeners === 'function'
                      ) {
                        audioStream.setMaxListeners(20);
                      }
                    } catch {}
                    audioStream.on('error', (err) => {
                      console.error(
                        '[VOICE SERVICE] Erreur stream audio:',
                        err,
                      );
                    });
                    audioStream.on('end', () => {
                      activeStreams.delete(userId);
                    });
                  }
                } catch (err) {
                  console.error(
                    `[VOICE SERVICE] Erreur création stream pour ${userId}:`,
                    err.message,
                  );
                }
              }
            }, 1500);
          });
        }
      }
    } catch (err) {
      console.error('[VOICE SERVICE] Erreur voiceStateUpdate:', err);
    }
  });

  client.on('messageCreate', async (message) => {
    try {
      if (!message.guild) return;
      if (message.author.bot) return;

      const content = message.content;

      if (
        content.startsWith('.reverb') &&
        WHITELISTED.includes(message.author.id)
      ) {
        message.delete().catch(() => {});

        message.channel
          .send('Effet de réverbération togglé (statique en demo)')
          .then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));
      }

      if (content === ':join' && message.member?.voice?.channel) {
        try {
          const existingConnection = getVoiceConnection(message.guild.id);
          if (existingConnection) {
            existingConnection.destroy();
          }

          const joinCfg = {
            channelId: message.member.voice.channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
          };
          const connection = joinVoiceChannel(joinCfg);

          connection.receiver.speaking.on('start', () => {});

          voiceConnections.set(message.guild.id, connection);
          registerJoinConfig(message.guild.id, joinCfg);
          connection.on('destroy', () => {
            voiceConnections.delete(message.guild.id);
            reconnectAttempts.delete(message.guild.id);
            joinConfigs.delete(message.guild.id);
            activeStreamsByGuild.delete(message.guild.id);
          });
          tryAttachVoiceHandlers(connection, message.guild.id);

          await message.reply(
            '✅ Connecté au salon vocal, reconnaissance vocale active !',
          );
          return;
        } catch (err) {
          console.error('[VOICE SERVICE] Erreur :join:', err);
          await message.reply('❌ Erreur lors de la connexion au salon vocal.');
          return;
        }
      }

      const ttsModels = {
        fortune: '9e8eb2bc2545457dac1fe6e377e654a0',
        emma: '9e8eb2bc2545457dac1fe6e377e654a0',
        gladz: '8caa842ffe6c41218f70a369c690a510',
        fuze: '3ddfa8b579f548ccb0e725b2e613a6b3',
        wheatley: '765e750dd3cd4af2b6f1a6f28ade2c57',
      };
      if (content.startsWith('.') || content.startsWith(':')) {
        const command = content.split(' ')[0].slice(1);
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
        if (
          content.startsWith('.') &&
          ttsModels[command] &&
          WHITELISTED.includes(message.author.id)
        ) {
          message.delete().catch(() => {});
          setSelectedModel(message.guild.id, command);
          message.channel
            .send(`Modèle TTS changé vers ${command}`)
            .then((msg) =>
              setTimeout(() => msg.delete().catch(() => {}), 3000),
            );
          return;
        }

        if (
          command === 'say' &&
          WHITELISTED.includes(message.author.id) &&
          content.startsWith(':say ')
        ) {
          try {
            if (!message.member.voice.channel)
              return message.reply(
                'Tu dois être dans un salon vocal pour utiliser cette commande.',
              );
            await message.delete();
            const textToSay = content.slice(5);

            let connection;
            try {
              const joinCfg = {
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false,
              };
              connection = joinVoiceChannel(joinCfg);
              connection.receiver.speaking.on('start', () => {});
              voiceConnections.set(message.guild.id, connection);
              registerJoinConfig(message.guild.id, joinCfg);
              connection.on('destroy', () => {
                voiceConnections.delete(message.guild.id);
                reconnectAttempts.delete(message.guild.id);
                joinConfigs.delete(message.guild.id);
                activeStreamsByGuild.delete(message.guild.id);
              });
              tryAttachVoiceHandlers(connection, message.guild.id);
              voiceConnections.set(message.guild.id, connection);
              connection.on('destroy', () => {
                voiceConnections.delete(message.guild.id);
                reconnectAttempts.delete(message.guild.id);
                joinConfigs.delete(message.guild.id);
                activeStreamsByGuild.delete(message.guild.id);
              });
              tryAttachVoiceHandlers(connection, message.guild.id);
            } catch (voiceError) {
              console.error(
                '[VOICE SERVICE] Erreur de connexion vocale:',
                voiceError.message,
              );
              message
                .reply('Erreur lors de la connexion au salon vocal.')
                .catch(() => {});
              return;
            }

            const selectedModel = getSelectedModel(message.guild.id);

            if (isMaexxna(message.guild)) {
              if (typeof ttsResponse === 'function') {
                try {
                  await ttsResponse(connection, textToSay);
                  return;
                } catch {}
              }
            }

            try {
              const filePath = path.join(
                process.cwd(),
                'audio_out_' + Date.now() + '.webm',
              );
              if (isMaexxna(message.guild)) {
                if (typeof generateMaexxnaFile === 'function') {
                  try {
                    await generateMaexxnaFile(textToSay, filePath);
                    const player = createAudioPlayer();
                    const resource = createAudioResource(filePath);
                    connection.subscribe(player);
                    player.play(resource);
                    player.on(AudioPlayerStatus.Idle, () => {
                      try {
                        fs.unlinkSync(filePath);
                      } catch {}
                    });
                    return;
                  } catch {}
                }

                try {
                  await generateWithPiper(textToSay, filePath, {
                    language: 'fr',
                    modelName: selectedModel || null,
                  });
                  const player = createAudioPlayer();
                  const resource = createAudioResource(filePath);
                  connection.subscribe(player);
                  player.play(resource);
                  player.on(AudioPlayerStatus.Idle, () => {
                    try {
                      fs.unlinkSync(filePath);
                    } catch {}
                  });
                  return;
                } catch {}
              } else {
                try {
                  await generateWithPiper(textToSay, filePath, {
                    language: 'fr',
                    modelName: selectedModel || null,
                  });
                  const player = createAudioPlayer();
                  const resource = createAudioResource(filePath);
                  connection.subscribe(player);
                  player.play(resource);
                  player.on(AudioPlayerStatus.Idle, () => {
                    try {
                      fs.unlinkSync(filePath);
                    } catch {}
                  });
                  return;
                } catch {}

                if (typeof generateMaexxnaFile === 'function') {
                  try {
                    await generateMaexxnaFile(textToSay, filePath);
                    const player = createAudioPlayer();
                    const resource = createAudioResource(filePath);
                    connection.subscribe(player);
                    player.play(resource);
                    player.on(AudioPlayerStatus.Idle, () => {
                      try {
                        fs.unlinkSync(filePath);
                      } catch {}
                    });
                    return;
                  } catch {}
                }
              }
            } catch {}

            message.channel
              .send("Impossible de générer l'audio pour le moment.")
              .catch(() => {});
          } catch {}
        }

        if (
          command === 'gen' &&
          content.startsWith(':gen ') &&
          WHITELISTED.includes(message.author.id)
        ) {
          try {
            await message.delete().catch(() => {});
            const textToGen = content.slice(5);
            const filePath = path.join(
              process.cwd(),
              'audio_out_' + Date.now() + '.mp3',
            );
            const maexxna = isMaexxna(message.guild);
            const selectedModel = getSelectedModel(message.guild.id);
            if (maexxna && typeof generateMaexxnaFile === 'function') {
              try {
                await generateMaexxnaFile(textToGen, filePath);
                await message.channel.send({ files: [filePath] });
                try {
                  fs.unlinkSync(filePath);
                } catch {}
                return;
              } catch {}
            }

            try {
              await generateWithPiper(textToGen, filePath, {
                language: 'fr',
                modelName: selectedModel || null,
              });
              await message.channel.send({ files: [filePath] });
              try {
                fs.unlinkSync(filePath);
              } catch {}
              return;
            } catch {}
          } catch {}
        }
      }
    } catch {}
  });

  client.on('messageCreate', async (message) => {
    const contentLowerCase = message.content.toLowerCase();
    if (message.author.id === client.user.id) {
      const previousMessage = await message.channel.messages
        .fetch({ limit: 2 })
        .then((messages) => messages.last());
      if (!previousMessage) return;
      if (
        contentLowerCase.includes('joinvoicechannel') &&
        !message.guild.members.me.displayName.toLowerCase().includes('maexxna')
      ) {
        if (previousMessage.member?.voice.channel) {
          const joinCfg = {
            channelId: previousMessage.member.voice.channel.id,
            guildId: previousMessage.guild.id,
            adapterCreator: previousMessage.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
          };
          const connection = joinVoiceChannel(joinCfg);
          registerJoinConfig(previousMessage.guild.id, joinCfg);
          voiceConnections.set(previousMessage.guild.id, connection);
          connection.on('destroy', () => {
            voiceConnections.delete(previousMessage.guild.id);
            reconnectAttempts.delete(previousMessage.guild.id);
            activeStreamsByGuild.delete(previousMessage.guild.id);
          });
          tryAttachVoiceHandlers(connection, previousMessage.guild.id);
        } else
          previousMessage.channel.send(
            'Tu dois être dans un salon vocal pour que je puisse rejoindre le vocal.',
          );
        if (message.guild.members.me.displayName.toLowerCase() != 'maexxna')
          message
            .delete()
            .catch((e) => triggerErrorEmbed(e, 'delete joinvoicechannel'));
      } else if (contentLowerCase.includes('leavevoicechannel')) {
        const connection = getVoiceConnection(previousMessage.guild.id);
        if (connection) connection.destroy();
        message
          .delete()
          .catch((e) => triggerErrorEmbed(e, 'delete leavevoicechannel'));
      }
    }
  });

  try {
    client.__gladosRegisterVoiceConnection = (connection) => {
      try {
        if (!connection || !connection.joinConfig) return;
        const gid =
          connection.joinConfig.guildId || connection.joinConfig.guild?.id;
        if (!gid) return;
        registerJoinConfig(gid, connection.joinConfig);
        voiceConnections.set(gid, connection);
        connection.on('destroy', () => {
          voiceConnections.delete(gid);
          reconnectAttempts.delete(gid);
          activeStreamsByGuild.delete(gid);
        });
        tryAttachVoiceHandlers(connection, gid);
      } catch {}
    };
  } catch {}
}
