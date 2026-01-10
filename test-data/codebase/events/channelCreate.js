import { AuditLogEvent, Events, UserFlagsBitField } from 'discord.js';
import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import {
  handleMaliciousBotReturn,
  isBotWhitelisted,
  markBotAsMalicious,
} from '../utils/antiRaidCoordinator.js';
import { logChannelCreated } from '../utils/channelUtils.js';
import { checkShards } from '../utils/checkShards.js';
import { handleChannelCreateRaid } from '../utils/handleChannelCreateRaid.js';
import { hasAuditLogPermission } from '../utils/logUtils.js';
import { hasBanMembersPermission } from '../utils/permissionsUtils.js';
import { markGuildAsProcessingChannelRaid } from '../utils/raidPriorityManager.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import {
  isGuildInRaid,
  pauseGuild,
  shouldPauseGuild,
  unpauseGuild,
} from '../utils/ultraFastAntiRaid.js';

const channelCreationMap = new Map();

async function handleChannelCreateSpamDetection(channel) {
  if (!channel || !channel.guild || !channel.guild.available) {
    return;
  }

  try {
    const auditLogs = await channel.guild.fetchAuditLogs({
      limit: 5,
      type: AuditLogEvent.ChannelCreate,
    });

    const creationEntry = auditLogs.entries.find(
      (entry) => entry.target?.id === channel.id,
    );

    if (!creationEntry || !creationEntry.executor) {
      return;
    }

    const executor = creationEntry.executor;
    const creatorId = executor.id;
    const isBot = executor.bot;

    if (!isBot) {
      return;
    }

    const isVerifiedBot =
      executor.flags?.has(UserFlagsBitField.Flags.VerifiedBot) || false;
    if (isVerifiedBot) {
      return;
    }

    if (await isBotWhitelisted(creatorId, channel.client)) {
      return;
    }

    const returnAction = await handleMaliciousBotReturn(
      channel.guild,
      creatorId,
      'channel_create',
    );

    if (returnAction === 'rebanned') {
      try {
        await channel.delete(
          'Bot malveillant rebanni - Suppression automatique',
        );
      } catch {
        triggerErrorEmbed(
          new Error('Échec suppression salon bot malveillant'),
          {
            source: 'channelCreateSpamDetection',
            action: 'delete_channel',
            botId: creatorId,
            guildId: channel.guild.id,
          },
        );
      }
      return;
    }

    const limit = 3;
    const threshold = 2000;
    const now = Date.now();

    if (!channelCreationMap.has(creatorId)) {
      channelCreationMap.set(creatorId, []);
    }

    const arr = channelCreationMap.get(creatorId);
    arr.push(now);

    if (arr.length === 1) {
      pauseGuild(channel.guild.id);
      markGuildAsProcessingChannelRaid(channel.guild.id, creatorId);
      setTimeout(() => {
        unpauseGuild(channel.guild.id);
      }, 10000);
      console.log(
        `[AntiRaid] ⏸️ Pause préventive sur le serveur ${channel.guild.id}: Bot non-vérifié ${creatorId} détecté en création de salon`,
      );
    }

    if (arr.length >= limit && now - arr[arr.length - limit] < threshold) {
      try {
        if (hasBanMembersPermission(channel.guild)) {
          await channel.guild.bans.create(creatorId, {
            reason: `Raid ultra-rapide: ${limit} salons créés en ${threshold}ms - Bot non vérifié`,
          });

          markBotAsMalicious(creatorId, true, channel.client);

          console.log(
            `[AntiRaid] 🚨 RAID ULTRA-RAPIDE DÉTECTÉ: ${creatorId} a créé ${limit} salons en < ${threshold}ms sur ${channel.guild.id}`,
          );
          console.log(
            `[AntiRaid] ✓ Bot ${creatorId} BANNI IMMÉDIATEMENT pour raid ultra-rapide`,
          );

          try {
            const recentAuditLogs = await channel.guild.fetchAuditLogs({
              limit: 20,
              type: AuditLogEvent.ChannelCreate,
            });

            const currentTime = Date.now();
            const channelsToDelete = recentAuditLogs.entries
              .filter(
                (entry) =>
                  entry.executor?.id === creatorId &&
                  currentTime - entry.createdTimestamp < 60000,
              )
              .map((entry) => channel.guild.channels.cache.get(entry.target.id))
              .filter(Boolean);

            if (channelsToDelete.length > 0) {
              console.log(
                `[AntiRaid] Suppression post-ban de ${channelsToDelete.length} salons créés par le bot spammeur ${creatorId}...`,
              );

              await Promise.allSettled(
                channelsToDelete.map((ch) =>
                  ch
                    .delete(
                      'Suppression post-ban bot spammeur (création massive)',
                    )
                    .then(() => {
                      console.log(
                        `[AntiRaid] Salon ${ch.id} supprimé post-ban.`,
                      );
                    })
                    .catch((err) => {
                      console.error(
                        `[AntiRaid] Échec suppression post-ban salon ${ch.id}:`,
                        err,
                      );
                    }),
                ),
              );
            }
          } catch (auditError) {
            console.error(
              '[AntiRaid] Erreur lors du cross-check suppression post-ban (création salons):',
              auditError,
            );
          }
        }

        channelCreationMap.set(creatorId, []);
      } catch (error) {
        if (![50013, 50001, 10003, 10008, 50034].includes(error.code)) {
          triggerErrorEmbed(error, {
            source: 'channelCreateSpamDetection',
            action: 'ban_bot',
            botId: creatorId,
            guildId: channel.guild.id,
          });
        }
      }
    }

    if (arr.length > 20) {
      channelCreationMap.set(
        creatorId,
        arr.filter((time) => now - time < 10000),
      );
    }
  } catch (error) {
    if (![50013, 50001, 10003, 10008].includes(error.code)) {
      triggerErrorEmbed(error, {
        source: 'channelCreateSpamDetection',
        action: 'detection',
        guildId: channel.guild?.id,
      });
    }
  }
}

export const name = Events.ChannelCreate;
export async function execute(channel, shardId) {
  if (channel.guild && shouldPauseGuild(channel.guild.id)) {
    console.log(
      `[AntiRaid] Event ChannelCreate ignoré sur ${channel.guild.id} (serveur en raid/pause)`,
    );
    return;
  }

  if (!checkShards(channel, shardId)) return;

  try {
    await handleChannelCreateSpamDetection(channel);
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'channelCreate',
      action: 'spam_detection',
      guildId: channel.guild?.id,
      shardId,
    });
  }

  if (ANTI_RAID_CONFIG.MASS_CREATE.PRIORITY_MODE) {
    if (isGuildInRaid(channel.guild.id)) {
      console.log(
        `[AntiRaid] Serveur ${channel.guild.id} en raid : aucune action supplémentaire.`,
      );
      return;
    }
  }

  try {
    await handleChannelCreateRaid(channel);
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'channelCreate',
      action: 'handle_raid',
      guildId: channel.guild?.id,
      shardId,
    });
  }

  if (hasAuditLogPermission(channel.guild)) {
    setImmediate(() => {
      logChannelCreated(channel, 'fr').catch(() => {});
    });
  }
}

