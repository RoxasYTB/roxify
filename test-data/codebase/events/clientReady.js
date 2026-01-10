import { ActivityType, Events, PermissionsBitField } from 'discord.js';
import fs from 'fs';
import { embedColor } from '../config/config.js';
import { decode, encode } from '../utils/3y3.js';
import { checkShards } from '../utils/checkShards.js';
import {
  cacheGet,
  cacheSet,
  debounce,
  safeExecute,
} from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import { updateClusterStats } from '../utils/updateStats.js';

const processedGiveaways = new Set();

let giveawayStats = {
  totalChecked: 0,
  totalEnded: 0,
  totalProcessed: 0,
  lastCheck: null,
  errors: 0,
};

const saveAllGuildsDebounced = debounce(
  (client, shardId) => saveAllGuilds(client, shardId),
  30000,
);

export const name = Events.ClientReady;
export async function execute(client) {
  const setStatus = () => {
    client.user.setActivity("J'aime bien ce point violet.", {
      type: ActivityType.Streaming,
      url: 'https://www.twitch.tv/plumette4',
    });
    client.user.setStatus('dnd');
  };
  setStatus();
  setInterval(setStatus, 15000);

  const actualShardId =
    Array.isArray(client.shard?.ids) ? client.shard.ids[0] : 0;
  const shardDir = './shards';
  const shardFilePath = `${shardDir}/shard-${actualShardId}.json`;

  try {
    await fs.promises.access(shardDir);
  } catch {
    await fs.promises.mkdir(shardDir, { recursive: true });
  }

  try {
    await fs.promises.access(shardFilePath);
  } catch {
    await fs.promises.writeFile(shardFilePath, '{}');
  }

  try {
    await fs.promises.access('./temp_restart.json');
    await handleRestart(client);
  } catch {}

  if (process.send) {
    process.send('ready');
  }

  setImmediate(() => {
    safeExecute(
      async () => {
        setTimeout(() => {
          checkGiveaways(client, actualShardId);
          setInterval(() => checkGiveaways(client, actualShardId), 120000);
        }, 30000);

        setTimeout(() => updateClusterStats(client), 45000);
        setInterval(() => updateClusterStats(client), 900000);

        setTimeout(() => saveAllGuildsDebounced(client, actualShardId), 90000);
        setInterval(
          () => saveAllGuildsDebounced(client, actualShardId),
          7200000,
        );
      },
      {
        command: 'ClientReady-DeferredTasks',
        client,
      },
    );
  });
}

async function handleRestart(client) {
  return safeExecute(
    async () => {
      if (!client || !client.channels) {
        triggerErrorEmbed(new Error('Client non valide dans handleRestart'), {
          action: 'handleRestart',
          step: 'client_validation',
          component: 'clientReady',
        });
        return;
      }

      if (!fs.existsSync('./temp_restart.json')) {
        return;
      }

      let restartData;
      try {
        const fileContent = await fs.promises.readFile(
          './temp_restart.json',
          'utf8',
        );
        if (!fileContent || fileContent.trim() === '') {
          await fs.promises.unlink('./temp_restart.json');
          return;
        }
        restartData = JSON.parse(fileContent);
      } catch (parseError) {
        triggerErrorEmbed(parseError, {
          action: 'handleRestart',
          step: 'parse_temp_file',
          component: 'clientReady',
        });
        try {
          await fs.promises.unlink('./temp_restart.json');
        } catch {}
        return;
      }

      const { channelId, messageId } = restartData;
      if (
        !channelId ||
        typeof channelId !== 'string' ||
        channelId.length < 10
      ) {
        triggerErrorEmbed(new Error('Channel ID non valide'), {
          action: 'handleRestart',
          step: 'channel_id_validation',
          channelId,
          component: 'clientReady',
        });
        try {
          await fs.promises.unlink('./temp_restart.json');
        } catch {}
        return;
      }

      if (
        !messageId ||
        typeof messageId !== 'string' ||
        messageId.length < 10
      ) {
        triggerErrorEmbed(new Error('Message ID non valide'), {
          action: 'handleRestart',
          step: 'message_id_validation',
          messageId,
          component: 'clientReady',
        });
        try {
          await fs.promises.unlink('./temp_restart.json');
        } catch {}
        return;
      }

      const channel = await client.channels
        .fetch(channelId)
        .catch(async (err) => {
          if (err.code === 10003) {
            try {
              await fs.promises.unlink('./temp_restart.json');
            } catch {}
            return null;
          }
          triggerErrorEmbed(err, {
            action: 'handleRestart',
            step: 'fetch_channel',
            channelId,
            component: 'clientReady',
          });
          throw err;
        });
      if (!channel) {
        return;
      }
      if (!channel.isTextBased() || !channel.send) {
        triggerErrorEmbed(
          new Error("Le canal n'est pas un canal textuel valide"),
          {
            action: 'handleRestart',
            step: 'channel_validation',
            channelId,
            component: 'clientReady',
          },
        );
        try {
          await fs.promises.unlink('./temp_restart.json');
        } catch {}
        return;
      }

      const message = await channel.messages
        .fetch(messageId)
        .catch(async (err) => {
          triggerErrorEmbed(err, {
            action: 'handleRestart',
            step: 'fetch_message',
            messageId,
            channelId,
            component: 'clientReady',
          });
          try {
            await fs.promises.unlink('./temp_restart.json');
          } catch {}
          return null;
        });

      if (!message || !message.edit) {
        try {
          await fs.promises.unlink('./temp_restart.json');
        } catch {}
        return;
      }
      await message
        .edit({
          embeds: [
            {
              color: embedColor,
              description:
                '<:true:1304519561814741063> **Redémarrage terminé avec succès!**',
              footer: {
                text: 'Je suis maintenant opérationnel.',
              },
            },
          ],
        })
        .catch((err) => {
          triggerErrorEmbed(err, {
            action: 'handleRestart',
            step: 'edit_message',
            messageId,
            channelId,
            component: 'clientReady',
          });
        });

      try {
        await fs.promises.unlink('./temp_restart.json');
      } catch {}
    },
    {
      command: 'HandleRestart',
    },
  );
}

async function saveAllGuilds(client, shardId) {
  return safeExecute(
    async () => {
      const cacheKey = `saveAllGuilds_${shardId}`;
      if (cacheGet(cacheKey)) return;

      cacheSet(cacheKey, true, 300000);

      const { saveGuild, cleanupInactiveThreads } = await import(
        '../utils/saveGuild.js'
      );
      const guilds = Array.from(client.guilds.cache.values()).filter((g) =>
        checkShards(g, shardId, true),
      );

      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        setTimeout(async () => {
          return safeExecute(
            async () => {
              if (guild?.available && guild.members?.me) {
                const now = new Date();
                const isCleanupTime =
                  now.getHours() === 3 && now.getMinutes() < 10;

                if (isCleanupTime) {
                  await cleanupInactiveThreads(guild);
                }

                await saveGuild(guild);
              }
            },
            {
              command: 'SaveGuild',
              guildId: guild.id,
            },
          );
        }, i * 2000);
      }
    },
    {
      command: 'SaveAllGuilds',
      shardId,
    },
  );
}

async function checkGiveaways(client, shardId) {
  return safeExecute(
    async () => {
      giveawayStats.lastCheck = new Date();

      if (!client || !client.channels || !client.channels.cache) {
        triggerErrorEmbed(new Error('Client non valide dans checkGiveaways'), {
          action: 'checkGiveaways',
          step: 'client_validation',
          component: 'clientReady',
        });
        return;
      }

      if (typeof shardId !== 'number' || shardId < 0) {
        triggerErrorEmbed(new Error('Shard ID non valide'), {
          action: 'checkGiveaways',
          step: 'shard_validation',
          shardId,
          component: 'clientReady',
        });
        return;
      }

      const chans = client.channels.cache.filter(
        (c) =>
          c &&
          c.guild &&
          c.topic &&
          typeof c.topic === 'string' &&
          c.topic.includes(encode('giveaway_')),
      );

      if (!chans || chans.size === 0) {
        return;
      }

      for (const channel of chans.values()) {
        if (!channel || !channel.guild || !checkShards(channel, shardId)) {
          continue;
        }
        if (!channel.permissionsFor || !client.user) {
          continue;
        }

        const permissions = channel.permissionsFor(client.user);
        if (
          !permissions ||
          !permissions.has([
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
          ])
        ) {
          continue;
        }
        await safeExecute(
          async () => {
            if (
              !channel.messages ||
              typeof channel.messages.fetch !== 'function'
            ) {
              return;
            }
            let msgs;
            try {
              msgs = await channel.messages.fetch();
            } catch (e) {
              void e;
              msgs = new Map();
            }

            if (!msgs || msgs.size === 0) {
              return;
            }

            for (const m of msgs.values()) {
              giveawayStats.totalChecked++;

              if (!m || m.author?.id !== client.user.id) {
                continue;
              }

              if (
                !m.embeds ||
                !Array.isArray(m.embeds) ||
                m.embeds.length === 0
              ) {
                continue;
              }

              const desc = m.embeds[0]?.description;
              if (!desc || typeof desc !== 'string') {
                continue;
              }

              if (
                desc.includes('Giveaway terminé') ||
                desc.includes('Giveaway ended')
              ) {
                try {
                  const canAddReactions = channel
                    .permissionsFor(client.user)
                    ?.has(PermissionsBitField.Flags.AddReactions);

                  if (canAddReactions) {
                    const hasReroll = m.reactions?.cache?.some(
                      (r) => r.emoji?.name === '🔄',
                    );
                    if (!hasReroll) {
                      const target =
                        m.partial ? await m.fetch().catch(() => null) : m;
                      if (target) {
                        await target.react('🔄').catch(() => {});
                      }
                    }
                  }
                } catch (e) {
                  void e;
                }
                continue;
              }

              const timeMatches = Array.from(
                desc.matchAll(/<t:(\d+):[a-zA-Z]?>/g),
              );
              let timestamp = null;
              if (timeMatches && timeMatches.length > 0) {
                for (const match of timeMatches) {
                  if (match[1] && /^\d+$/.test(match[1])) {
                    const ts = parseInt(match[1], 10);
                    if (!isNaN(ts) && ts > 0) {
                      timestamp = ts;
                      break;
                    }
                  }
                }
              }
              if (!timestamp) {
                continue;
              }

              const now = Date.now();
              const endTime = timestamp * 1000;

              const isExpired = now >= endTime;

              if (isExpired) {
                giveawayStats.totalEnded++;

                const giveawayKey = `${m.id}-${timestamp}`;
                if (processedGiveaways.has(giveawayKey)) {
                  continue;
                }

                processedGiveaways.add(giveawayKey);
                giveawayStats.totalProcessed++;

                if (processedGiveaways.size > 100) {
                  const oldestEntries = Array.from(processedGiveaways).slice(
                    0,
                    50,
                  );
                  oldestEntries.forEach((entry) =>
                    processedGiveaways.delete(entry),
                  );
                }

                await handleGiveawayEnd(client, channel, m);
              }
            }
          },
          {
            command: 'CheckGiveawayMessages',
            channelId: channel.id,
            silent: true,
          },
        );
      }
    },
    {
      command: 'CheckGiveaways',
      shardId,
    },
  );
}

async function handleGiveawayEnd(client, channel, message) {
  return safeExecute(
    async () => {
      try {
        await channel.messages.fetch(message.id);
      } catch (e) {
        void e;
        return;
      }

      if (
        !client?.user ||
        !channel?.permissionsFor ||
        !channel?.send ||
        !message?.reactions
      ) {
        return;
      }

      const permissions = channel.permissionsFor(client.user);
      const hasViewChannel = permissions?.has(
        PermissionsBitField.Flags.ViewChannel,
      );
      const hasReadHistory = permissions?.has(
        PermissionsBitField.Flags.ReadMessageHistory,
      );
      const hasSendMessages = permissions?.has(
        PermissionsBitField.Flags.SendMessages,
      );

      if (!hasViewChannel || !hasReadHistory) {
        return;
      }

      const hasMessageReactions = client.options.intents?.has?.(1 << 10);
      if (!hasMessageReactions) {
        return;
      }

      let users = new Map();

      try {
        const reactionUsers = await client.rest.get(
          `/channels/${channel.id}/messages/${message.id}/reactions/🎉`,
          { query: { limit: 100 } },
        );

        if (reactionUsers && Array.isArray(reactionUsers)) {
          const restUsers = new Map();
          for (const userData of reactionUsers) {
            if (userData.id && !userData.bot) {
              const user = {
                id: userData.id,
                username:
                  userData.username || userData.global_name || 'Unknown',
                discriminator: userData.discriminator,
                bot: userData.bot || false,
              };
              restUsers.set(userData.id, user);
            }
          }
          users = restUsers;
        }
      } catch (e) {
        void e;
        return;
      }

      let winnersCount = 1;
      if (message.content && typeof message.content === 'string') {
        try {
          const decodedContent = decode(message.content);
          if (typeof decodedContent === 'string') {
            const splitContent = decodedContent.split('_');
            if (splitContent[3]) {
              const parsedCount = parseInt(splitContent[3], 10);
              if (!isNaN(parsedCount) && parsedCount > 0 && parsedCount <= 20) {
                winnersCount = parsedCount;
              }
            }
          }
        } catch (e) {
          void e;
        }
      }

      const validUsers = new Map();
      for (const [id, user] of users) {
        if (!user.bot) {
          validUsers.set(id, user);
        }
      }
      const winners = [];

      if (validUsers.size > 0) {
        const userArray = Array.from(validUsers.values());
        const actualWinnersCount = Math.min(winnersCount, userArray.length);

        for (let i = 0; i < actualWinnersCount; i++) {
          const randomIndex = Math.floor(Math.random() * userArray.length);
          const winner = userArray.splice(randomIndex, 1)[0];
          winners.push(winner);
        }
      }

      try {
        const newEmbed = {
          color: embedColor,
          description: `🎉 Giveaway terminé ! 🎉\nGagnants: ${
            winners.length > 0 ?
              winners.map((w) => `<@${w.id}>`).join(', ')
            : 'Aucun participant'
          }`,
          footer: { text: 'Le giveaway est terminé.' },
        };

        let targetMessage = message;
        if (message.partial) {
          targetMessage = await message.fetch();
        }

        const canEditMessage =
          targetMessage.author.id === client.user.id ||
          channel
            .permissionsFor(client.user)
            ?.has(PermissionsBitField.Flags.ManageMessages);

        if (canEditMessage) {
          await targetMessage.edit({ embeds: [newEmbed] });

          const canAddReactions = channel
            .permissionsFor(client.user)
            ?.has(PermissionsBitField.Flags.AddReactions);
          if (canAddReactions) {
            await targetMessage.react('🔄').catch(() => {});
          }
        }
      } catch (e) {
        void e;
        return;
      }

      if (hasSendMessages) {
        try {
          const finalMessage =
            winners.length > 0 ?
              `🎉 Giveaway terminé ! Gagnants : ${winners
                .map((w) => `<@${w.id}>`)
                .join(', ')}`
            : `🎉 Giveaway terminé ! Aucun participant n'a été trouvé.`;

          await channel.send(finalMessage);
        } catch (e) {
          void e;
        }
      }
    },
    {
      command: 'HandleGiveawayEnd',
      messageId: message.id,
      channelId: channel.id,
    },
  );
}

