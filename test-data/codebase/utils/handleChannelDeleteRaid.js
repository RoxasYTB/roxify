import {
  AuditLogEvent,
  PermissionsBitField,
  UserFlagsBitField,
} from 'discord.js';
import { restoreserver } from '../commands/other/restoreserver.js';
import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import whitelist from '../whitelist.json' with { type: 'json' };
import { markBotForEnhancedMonitoring } from './antiRaidCoordinator.js';
import './createRaidReport.js';
import { handleComboRaid } from './handleComboRaid.js';
import './specialCommandHandler.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';
import { scheduleDelayedChannelCleanup } from './ultraFastRaidDetection.js';

import {
  findExistingEmergencyChannel,
  getAllChannelsCreatedByBot,
  getCentralRaidData,
  handleMaliciousBotReturn,
  isAntiNukeCreationInProgress,
  isBotWhitelisted,
  isEmergencyChannelCreationInProgress,
  lockAntiNukeCreation,
  lockEmergencyChannelCreation,
  lockRestoration,
  markBotAsMalicious,
  markComboRaidDetected,
  markGuildSecure,
  markGuildUnderAttack,
  recordBlockedAction,
  recordSuspiciousActivity,
  unlockAntiNukeCreation,
  unlockEmergencyChannelCreation,
  unlockRestoration,
} from './antiRaidCoordinator.js';

import { embedColor } from '../config/config.js';
import { sendUniqueRaidReport } from './raidReportManager.js';

const MASS_DELETE_THRESHOLD = ANTI_RAID_CONFIG.MASS_DELETE.THRESHOLD;
const TIME_WINDOW = ANTI_RAID_CONFIG.MASS_DELETE.TIME_WINDOW;

let auditLogsCache = new Map();
let botCache = new Map();

function getDeletedChannelsData(guildId) {
  const centralData = getCentralRaidData();
  return centralData.deletedChannels[guildId] || [];
}

function getCreatedChannelsByBotData(guildId, botId) {
  const centralData = getCentralRaidData();
  return (
    (centralData.createdChannelsByBot[guildId] &&
      centralData.createdChannelsByBot[guildId][botId]) ||
    []
  );
}

function isServerCritical(guild) {
  const usableChannels = guild.channels.cache.filter(
    (c) => ![15, 4].includes(c.type),
  );

  const minChannels = guild.features?.includes('COMMUNITY') ? 2 : 0;

  return usableChannels.size <= minChannels;
}

async function triggerEmergencyAntiRaid(guild, suspiciousBotId) {
  const guildId = guild.id;

  try {
    if (
      isEmergencyChannelCreationInProgress(guildId) ||
      isAntiNukeCreationInProgress(guildId)
    ) {
      return;
    }

    if (
      !lockEmergencyChannelCreation(guildId) ||
      !lockAntiNukeCreation(guildId)
    ) {
      return;
    }

    try {
      const [existingChannel] = await Promise.allSettled([
        findExistingEmergencyChannel(guild),

        Promise.resolve().then(() => {
          markGuildUnderAttack(guildId, 'critical_deletion', suspiciousBotId);
          markBotAsMalicious(suspiciousBotId, true, true);
        }),
      ]);

      if (existingChannel.status === 'fulfilled' && existingChannel.value) {
        setImmediate(() =>
          handleExistingEmergencyChannel(
            guild,
            existingChannel.value,
            suspiciousBotId,
          ),
        );
        return;
      }

      const emergencyOps = [
        banMaliciousBot(guild, suspiciousBotId),
        createEmergencyChannel(guild, suspiciousBotId),
      ];

      const timeout = ANTI_RAID_CONFIG.EMERGENCY.IMMEDIATE_BAN_TIMEOUT;
      await Promise.race([
        Promise.allSettled(emergencyOps),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Emergency timeout')), timeout),
        ),
      ]).catch(() => {
        setImmediate(() => Promise.allSettled(emergencyOps));
      });
    } finally {
      setImmediate(() => {
        unlockEmergencyChannelCreation(guildId);
        unlockAntiNukeCreation(guildId);
      });
    }
  } catch (error) {
    unlockEmergencyChannelCreation(guildId);
    unlockAntiNukeCreation(guildId);
    triggerErrorEmbed(error, {
      source: 'handleChannelDeleteRaid.js',
      action: 'trigger_emergency_anti_raid',
      guildId: guild?.id,
    });
  }
}

async function handleExistingEmergencyChannel(
  guild,
  existingChannel,
  suspiciousBotId,
) {
  try {
    markGuildUnderAttack(guild.id, 'critical_deletion', suspiciousBotId);
    markBotAsMalicious(suspiciousBotId);

    await banMaliciousBot(guild, suspiciousBotId);
  } catch {}
}

async function analyzeRecentDeletions(guild, botId) {
  try {
    const now = Date.now();

    const auditLogs = await guild.fetchAuditLogs({
      limit: 100,
      type: AuditLogEvent.ChannelDelete,
    });

    const deletionsByBot = [];
    const channelsToRestore = [];

    for (const entry of auditLogs.entries.values()) {
      const timeDiff = now - entry.createdTimestamp;

      if (timeDiff < TIME_WINDOW && entry.executor?.id === botId) {
        deletionsByBot.push({
          channelId: entry.target?.id,
          channelName: entry.target?.name,
          channelType: entry.target?.type,
          timestamp: entry.createdTimestamp,
          deletorId: entry.executor.id,
        });

        if (entry.target) {
          channelsToRestore.push({
            id: entry.target.id,
            name: entry.target.name,
            type: entry.target.type,
            parentId: entry.target.parentId,
            position: entry.target.position,
          });
        }
      }
    }

    return {
      deletions: deletionsByBot,
      channelsToRestore,
      isRaidDetected: deletionsByBot.length >= MASS_DELETE_THRESHOLD,
      isCritical: await checkIfServerCritical(guild, deletionsByBot.length),
    };
  } catch {
    return {
      deletions: [],
      channelsToRestore: [],
      isRaidDetected: false,
      isCritical: false,
    };
  }
}

async function checkIfServerCritical(guild, additionalDeletions = 0) {
  const usableChannels = guild.channels.cache.filter(
    (c) => ![15, 4].includes(c.type),
  );

  const currentCount = usableChannels.size;
  const projectedCount = currentCount - additionalDeletions;
  const minChannels = guild.features?.includes('COMMUNITY') ? 2 : 0;

  return projectedCount <= minChannels;
}

async function removeAllBotPermissions(guild, botId) {
  try {
    const botMember = await guild.members.fetch(botId).catch(() => null);

    if (!botMember) {
      return false;
    }

    const gladosMember = guild.members.me;

    if (!gladosMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return false;
    }

    const dangerousPermissions = [
      PermissionsBitField.Flags.Administrator,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.BanMembers,
      PermissionsBitField.Flags.KickMembers,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.MentionEveryone,
    ];

    let permissionsRemoved = false;

    for (const role of botMember.roles.cache.values()) {
      if (role.id === guild.id) continue;

      if (role.position >= gladosMember.roles.highest.position) {
        continue;
      }

      const hasDestructivePermissions = dangerousPermissions.some((perm) =>
        role.permissions.has(perm),
      );

      if (hasDestructivePermissions) {
        if (!role.managed) {
          await botMember.roles.remove(
            role,
            'Retrait rôle bot malveillant - Protection GLaDOS',
          );
          permissionsRemoved = true;

          continue;
        }

        if (
          role.managed ||
          role.name.includes('bot') ||
          role.name.includes(botMember.user.username)
        ) {
          const currentPermissions = role.permissions;
          const newPermissions =
            currentPermissions.remove(dangerousPermissions);

          await role.setPermissions(
            newPermissions,
            'Retrait permissions dangereuses bot malveillant - Protection GLaDOS',
          );
          permissionsRemoved = true;
        }
      }
    }

    return permissionsRemoved;
  } catch {
    return false;
  }
}

async function deleteAllChannelsCreatedByBot(guild, botId) {
  if (
    (await isBotWhitelisted(botId, guild.client)) ||
    botId === guild.client.user.id
  ) {
    return 0;
  }

  try {
    await removeAllBotPermissions(guild, botId);

    const now = Date.now();
    const channelsToDelete = new Map();
    let deletedCount = 0;
    try {
      await guild.channels.fetch();
    } catch (fetchError) {
      console.error(
        `Erreur fetch canaux deleteAllChannelsCreatedByBot: ${fetchError.message}`,
      );
    }

    try {
      const centralChannels = getAllChannelsCreatedByBot(guild.id, botId);
      for (const channelData of centralChannels) {
        const channelToDelete = guild.channels.cache.get(channelData.channelId);
        if (channelToDelete && channelToDelete.type === 0) {
          channelsToDelete.set(channelToDelete.id, {
            channel: channelToDelete,
            createdAt: channelData.timestamp,
            source: 'central_cache',
          });
        }
      }
    } catch {}

    try {
      const auditLogs = await guild.fetchAuditLogs({
        limit: 100,
        type: AuditLogEvent.ChannelCreate,
      });

      for (const entry of auditLogs.entries.values()) {
        if (entry.executor?.id === botId) {
          const channelId = entry.target?.id;
          const channelToDelete = guild.channels.cache.get(channelId);

          if (
            channelToDelete &&
            channelToDelete.type === 0 &&
            !channelsToDelete.has(channelId)
          ) {
            channelsToDelete.set(channelId, {
              channel: channelToDelete,
              createdAt: entry.createdTimestamp,
              source: 'audit_logs',
            });
          }
        }
      }
    } catch {}

    try {
      const suspiciousPatterns = [
        /^(raid|spam|hack|nuke|delete|destroy|temp|test)/i,
        /^(general|chat|random)\d+$/i,
        /^[\w\-_]+\d{3,}$/,
        /[0-9]{8,}/,
        /^(bot|automated|auto)/i,
      ];

      guild.channels.cache.filter((channel) => {
        if (channel.type !== 0) return false;
        if (now - channel.createdTimestamp > TIME_WINDOW * 10) return false;
        return suspiciousPatterns.some((pattern) => pattern.test(channel.name));
      });
    } catch {}
    if (channelsToDelete.size > 0) {
      const deletionPromises = Array.from(channelsToDelete.values()).map(
        async ({ channel, source }) => {
          try {
            const freshChannel = guild.channels.cache.get(channel.id);
            if (!freshChannel) {
              return {
                success: true,
                channelId: channel.id,
                name: channel.name,
                alreadyDeleted: true,
              };
            }

            await freshChannel.delete(
              `Salon créé par bot malveillant ${botId} - GLaDOS (${source})`,
            );
            deletedCount++;

            return {
              success: true,
              channelId: channel.id,
              name: channel.name,
            };
          } catch (deleteError) {
            if (deleteError.code === 10003) {
              return {
                success: true,
                channelId: channel.id,
                name: channel.name,
                alreadyDeleted: true,
              };
            }

            return {
              success: false,
              channelId: channel.id,
              error: deleteError.message,
            };
          }
        },
      );

      await Promise.allSettled(deletionPromises);
    }

    return deletedCount;
  } catch {
    return 0;
  }
}

async function banMaliciousBot(guild, botId) {
  if (
    (await isBotWhitelisted(botId, guild.client)) ||
    botId === guild.client.user.id
  ) {
    return false;
  }

  try {
    if (!botId || botId === 'undefined' || !/^\d{17,19}$/.test(botId)) {
      return false;
    }

    const isBot = await isUserBot(guild, botId);

    if (!isBot) {
      return false;
    }

    if (await isBotWhitelisted(botId, guild.client)) {
      return false;
    }
    let banSuccess = false;
    try {
      await guild.bans.create(botId, {
        reason:
          'GLaDOS Ban First: Suppression massive de salons - Bannissement immédiat',
      });
      banSuccess = true;
      markBotAsMalicious(botId);
    } catch (banError) {
      if (ANTI_RAID_CONFIG.DEBUG?.ENABLED) {
        console.error(
          `Erreur bannissement immédiat suppression: ${banError.message}`,
        );
      }
    }

    setImmediate(async () => {
      try {
        await sendUniqueRaidReport(
          guild,
          '🗑️ RAID DE SUPPRESSION MASSIVE CONTRÉ',
          {
            description:
              `**ATTAQUE DE SUPPRESSION MASSIVE DÉTECTÉE**\n\n` +
              `**Bot Malveillant:** <@${botId}> (${botId})\n` +
              `**Type:** Suppression massive de salons\n` +
              `**Actions Prises:**\n` +
              `<:true:1180540823557918812> ${banSuccess ? 'Bot banni immédiatement' : 'Tentative bannissement'}\n` +
              `<:true:1180540823557918812> Permissions en cours de retrait\n` +
              `<:true:1180540823557918812> Restauration automatique déclenchée\n\n` +
              `**Status:** ${banSuccess ? '🟢 Bot neutralisé' : '🟠 Neutralisation en cours...'}`,
            color: banSuccess ? 0x00ff00 : 0xff4444,
          },
          'mass_delete_detection',
          botId,
        );
      } catch {
        console.error(
          `Erreur envoi rapport RAID DE SUPPRESSION MASSIVE CONTRÉ pour le bot ${botId}`,
        );
      }
    });

    setImmediate(async () => {
      try {
        await removeAllBotPermissions(guild, botId);
      } catch (permError) {
        if (ANTI_RAID_CONFIG.DEBUG?.ENABLED) {
          console.error(
            'Erreur retrait permissions suppression:',
            permError.message,
          );
        }
      }
    });
    setTimeout(() => {
      scheduleDelayedChannelCleanup(guild, botId);
    }, 1000);

    return banSuccess;
  } catch (banError) {
    if (banError.code === 10013) {
      markBotAsMalicious(botId);
      return false;
    }
    return false;
  }
}

async function handleChannelDeleteRaid(channel) {
  try {
    setImmediate(() => startServerRestoration(channel.guild));

    const auditCacheKey = `${guildId}_audit_${Math.floor(now / 1000)}`;
    let auditLogs = auditLogsCache?.get(auditCacheKey);

    if (!auditLogs) {
      auditLogs = await channel.guild.fetchAuditLogs({
        limit: 3,
        type: AuditLogEvent.ChannelDelete,
      });

      if (!auditLogsCache) auditLogsCache = new Map();
      auditLogsCache.set(auditCacheKey, auditLogs);
      setTimeout(() => auditLogsCache.delete(auditCacheKey), 1000);
    }
    const deletorEntry = auditLogs.entries.first();
    const creatorId = deletorEntry?.executor?.id;
    if (!creatorId || whitelist.WhitelistedBots.includes(creatorId)) {
      return;
    }

    const user = deletorEntry?.executor;
    const isVerifiedBot =
      user?.flags?.has(UserFlagsBitField.Flags.VerifiedBot) || false;

    if (isVerifiedBot) {
      return;
    }

    const botCacheKey = `${creatorId}_isbot`;
    let isBot = botCache?.get(botCacheKey);

    if (isBot === undefined) {
      isBot = await isUserBot(channel.guild, creatorId);
      if (!botCache) botCache = new Map();
      botCache.set(botCacheKey, isBot);
      setTimeout(() => botCache.delete(botCacheKey), 30000);
    }

    if (isBot) {
      const returnAction = await handleMaliciousBotReturn(
        channel.guild,
        creatorId,
        'attack',
      );
      if (returnAction === 'rebanned') {
        return;
      } else if (returnAction === 'reset_data') {
        setImmediate(() => triggerEmergencyAntiRaid(channel.guild, creatorId));

        return;
      }
    }

    const isCritical = isServerCritical(channel.guild);
    if (isCritical) {
      const rapidAnalysis = await analyzeRecentDeletions(
        channel.guild,
        creatorId,
      );

      if (creatorId === channel.guild.ownerId) {
        setImmediate(() =>
          handleMaliciousOwner(channel.guild, creatorId, rapidAnalysis),
        );
      } else if (isBot) {
        setImmediate(() => triggerEmergencyAntiRaid(channel.guild, creatorId));
      }
      return;
    }

    const analysisResult = await analyzeRecentDeletions(
      channel.guild,
      creatorId,
    );

    if (analysisResult.isRaidDetected) {
      if (!isBot) {
        recordBlockedAction(guildId, 'channel_delete_human', creatorId, false);
        return;
      }

      const potentialComboRaid = await checkForPotentialComboRaid(
        channel.guild,
        creatorId,
      );

      if (potentialComboRaid) {
        markComboRaidDetected(guildId, creatorId);
        await handleComboRaid(channel.guild, creatorId, analysisResult);
        return;
      }

      if (creatorId === channel.guild.ownerId) {
        await handleMaliciousOwner(channel.guild, creatorId, analysisResult);
        return;
      }

      markGuildUnderAttack(guildId, 'mass_delete', creatorId);

      await deleteAllChannelsCreatedByBot(channel.guild, creatorId);

      await banMaliciousBot(channel.guild, creatorId);

      if (analysisResult.isCritical || isServerCritical(channel.guild)) {
        await startServerRestoration(channel.guild, null, creatorId);
      }

      setTimeout(() => {
        markGuildSecure(guildId);
      }, 5000);
    } else {
      recordSuspiciousActivity(guildId, creatorId, 'deletion', 1, isBot);
      monitorRealTimeChannelCreations(channel.guild, creatorId);
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleChannelDeleteRaid.js',
      action: 'channel_delete_detection',
      guildId: channel?.guild?.id,
    });
  }
}

async function isUserBot(guild, userId) {
  try {
    const member = guild.members.cache.get(userId);
    if (member) {
      return member.user.bot;
    }

    const fetchedMember = await guild.members.fetch(userId).catch(() => null);
    if (fetchedMember) {
      return fetchedMember.user.bot;
    }

    const user = await guild.client.users.fetch(userId).catch(() => null);
    return user ? user.bot : false;
  } catch {
    return false;
  }
}

async function handleMaliciousOwner(guild, ownerId, analysisResult) {
  try {
    markGuildUnderAttack(guild.id, 'owner_mass_delete', ownerId);

    const isBot = await isUserBot(guild, ownerId);

    if (isBot) {
      markBotAsMalicious(ownerId);
    }

    await deleteAllChannelsCreatedByBot(guild, ownerId);

    if (analysisResult.isCritical || isServerCritical(guild)) {
      await createEmergencyChannel(guild);
    }
  } catch {}
}

async function sendOwnerRaidReport() {
  return;
}

function monitorRealTimeChannelCreations(guild, botId) {
  recordSuspiciousActivity(guild.id, botId, 'deletion', 1, true);

  if (typeof markBotForEnhancedMonitoring === 'function') {
    markBotForEnhancedMonitoring(guild.id, botId);
  }
}

async function checkForPotentialComboRaid(guild, botId) {
  const createdChannels = getCreatedChannelsByBotData(guild.id, botId);

  if (createdChannels.length === 0) {
    return false;
  }

  const now = Date.now();
  const recentCreations = createdChannels.filter(
    (c) => now - c.timestamp < TIME_WINDOW,
  );

  if (recentCreations.length >= 2) {
    return true;
  }

  return false;
}

async function sendComboRaidReport(
  guild,
  botId,
  analysisResult,
  deletedChannelsCount,
) {
  await sendUniqueRaidReport(
    guild,
    '🔥 RAID COMBO DÉTECTÉ ET CONTRÉ',
    {
      description:
        `**ATTAQUE COMBINÉE SOPHISTIQUÉE DÉTECTÉE**\n\n` +
        `**Bot Malveillant:** <@${botId}> (${botId})\n` +
        `**Type:** Suppression massive + Création de salons\n` +
        `**Suppressions détectées:** ${analysisResult.deletions.length}\n` +
        `**Salons malveillants supprimés:** ${deletedChannelsCount}\n\n` +
        `**Actions Prises:**\n` +
        `<:true:1180540823557918812> Bot immédiatement banni\n` +
        `<:true:1180540823557918812> Tous les salons créés par le bot supprimés\n` +
        `<:true:1180540823557918812> Restauration des salons légitimes déclenchée\n` +
        `<:true:1180540823557918812> Surveillance renforcée activée\n\n` +
        `**Status:** 🟢 Menace neutralisée`,
      color: 0x8b0000,
    },
    'combo_raid_detection',
    botId,
  );
}

async function createEmergencyChannel(guild, suspiciousBotId = null) {
  const guildId = guild.id;

  try {
    if (!guild || !guild.available) {
      return null;
    }

    const existingChannel = findExistingEmergencyChannel(guild);
    if (existingChannel) {
      return existingChannel;
    }

    if (isAntiNukeCreationInProgress(guildId)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return findExistingEmergencyChannel(guild) || null;
    }

    let emergencyChannel = null;

    try {
      emergencyChannel = await guild.channels.create({
        name: 'anti-nuke-urgence',
        type: 0,
        topic: "Salon d'urgence créé par GLaDOS - Restauration en cours",
        reason: "Création d'urgence suite à une attaque détectée",
      });
    } catch {
      try {
        emergencyChannel = await guild.channels.create({
          name: 'urgence',
          type: 0,
          reason: "Salon d'urgence (fallback) suite à une attaque",
        });
      } catch {
        return null;
      }
    }

    try {
      const emergencyEmbed = {
        color: embedColor,
        title: "🚨 Mode de Protection d'Urgence Activé",
        description:
          `**Attaque détectée et contrée**\n\n` +
          `GLaDOS a détecté une tentative d'attaque sur ce serveur et a ` +
          `immédiatement pris les mesures de protection nécessaires.\n\n` +
          `**Actions automatiques en cours:**\n` +
          `🔄 Restauration des salons supprimés\n` +
          `🚫 Bots malveillants bannis\n` +
          `🛡️ Surveillance renforcée activée\n\n` +
          `**Ce salon sera supprimé une fois la restauration terminée.**`,
        timestamp: new Date(),
        footer: {
          text: 'GLaDOS Protection System',
        },
      };

      await emergencyChannel.send({
        embeds: [emergencyEmbed],
      });
    } catch {}

    try {
      await startServerRestoration(guild, emergencyChannel, suspiciousBotId);
    } catch {}

    return emergencyChannel;
  } catch {
    return null;
  }
}

async function startServerRestoration(
  guild,
  emergencyChannel = null,
  maliciousBotId = null,
) {
  try {
    if (!guild || !guild.available) {
      throw new Error('Guild non disponible pour la restauration');
    }

    if (!lockRestoration(guild.id)) {
      return;
    }

    try {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de restauration')), 30000),
        );

        const restorePromise = restoreserver(null, guild.id, guild);

        const restoreResult = await Promise.race([
          restorePromise,
          timeoutPromise,
        ]);

        if (restoreResult) {
          if (emergencyChannel) {
            await sendRestorationSuccessMessage(emergencyChannel);
          }
        } else {
          throw new Error('Échec de la restauration principale');
        }
      } catch {
        const fallbackSuccess = await createBasicChannelFallback(guild);

        if (fallbackSuccess) {
          await sendRestorationFallbackMessage(
            emergencyChannel,
            'basic_channel',
          );
        } else {
          const existingChannel = await findUsableChannel(guild);
          if (existingChannel) {
            await sendRestorationFallbackMessage(
              emergencyChannel,
              'existing_channel',
              existingChannel,
            );
          } else {
            const minimalSuccess = await createMinimalChannelFallback(guild);
            if (minimalSuccess) {
              await sendRestorationFallbackMessage(
                emergencyChannel,
                'minimal_channel',
              );
            } else {
              await sendRestorationFailureMessage(emergencyChannel);
            }
          }
        }
      }

      if (maliciousBotId) {
        setImmediate(async () => {
          try {
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const deletionResult = await deleteAllChannelsCreatedByBot(
              guild,
              maliciousBotId,
            );

            if (deletionResult.channelsDeleted > 0) {
              console.log(
                `[AntiRaid] Post-restauration: ${deletionResult.channelsDeleted} salons du bot ${maliciousBotId} supprimés`,
              );
            }
          } catch (cleanupError) {
            triggerErrorEmbed(cleanupError, {
              source: 'handleChannelDeleteRaid.js',
              action: 'post_restoration_cleanup',
              guildId: guild?.id,
              botId: maliciousBotId,
            });
          }
        });
      }

      if (emergencyChannel) {
        setTimeout(async () => {
          try {
            await emergencyChannel.delete(
              'Restauration terminée - suppression salon urgence',
            );
          } catch {}
        }, 5000);
      }
    } finally {
      unlockRestoration(guild.id);
    }
  } catch (error) {
    unlockRestoration(guild.id);

    triggerErrorEmbed(error, {
      source: 'handleChannelDeleteRaid.js',
      action: 'start_server_restoration',
      guildId: guild?.id,
    });
  }
}

async function createBasicChannelFallback(guild) {
  try {
    const usableChannels = guild.channels.cache.filter(
      (c) => c.type === 0 && c.isTextBased(),
    );

    if (usableChannels.size > 0) {
      return true;
    }

    if (isAntiNukeCreationInProgress(guild.id)) {
      return false;
    }

    if (!lockAntiNukeCreation(guild.id)) {
      return false;
    }

    try {
      await guild.channels.create({
        name: 'general',
        type: 0,
        topic: 'Salon principal restauré automatiquement par GLaDOS',
        reason:
          'Création fallback après échec de restauration complète - Protection GLaDOS',
      });

      return true;
    } finally {
      unlockAntiNukeCreation(guild.id);
    }
  } catch {
    return false;
  }
}

async function findUsableChannel(guild) {
  try {
    const textChannels = guild.channels.cache.filter(
      (c) => c.type === 0 && c.isTextBased() && c.viewable,
    );

    if (textChannels.size > 0) {
      const preferredNames = ['general', 'chat', 'discussion', 'salon'];

      for (const preferredName of preferredNames) {
        const preferredChannel = textChannels.find((c) =>
          c.name.toLowerCase().includes(preferredName),
        );
        if (preferredChannel) {
          return preferredChannel;
        }
      }

      return textChannels.first();
    }

    return null;
  } catch {
    return null;
  }
}

async function createMinimalChannelFallback(guild) {
  const minimalNames = ['chat', 'salon', 'text', 'channel', 'main'];

  if (isAntiNukeCreationInProgress(guild.id)) {
    return false;
  }

  if (!lockAntiNukeCreation(guild.id)) {
    return false;
  }

  try {
    for (const name of minimalNames) {
      try {
        await guild.channels.create({
          name: name,
          type: 0,
          reason: "Création minimale d'urgence - Protection GLaDOS",
        });

        return true;
      } catch {
        continue;
      }
    }

    return false;
  } finally {
    unlockAntiNukeCreation(guild.id);
  }
}

async function sendRestorationSuccessMessage(emergencyChannel) {
  if (!emergencyChannel || !emergencyChannel.isTextBased()) return;

  try {
    await emergencyChannel.send({
      embeds: [
        {
          color: embedColor,
          title: '<:true:1180540823557918812> Restauration Complète Réussie',
          description:
            '**Le serveur a été restauré avec succès!**\n\n' +
            '• Tous les salons ont été récupérés\n' +
            '• Les permissions ont été restaurées\n' +
            '• La structure du serveur est intacte\n\n' +
            '*Ce salon sera supprimé dans quelques secondes.*',
          timestamp: new Date(),
          footer: {
            text: 'GLaDOS Protection System',
          },
        },
      ],
    });
  } catch {}
}

async function sendRestorationFallbackMessage(
  emergencyChannel,
  fallbackType,
  existingChannel = null,
) {
  if (!emergencyChannel || !emergencyChannel.isTextBased()) return;

  try {
    let title = '';
    let description = '';
    let color = embedColor;

    switch (fallbackType) {
      case 'basic_channel':
        title = '🆘 Restauration Partielle';
        description =
          '**La restauration complète a échoué, mais un salon de base a été créé.**\n\n' +
          '• Un salon "general" est maintenant disponible\n' +
          '• Le serveur est fonctionnel\n' +
          '• Vous pouvez recréer les autres salons manuellement\n\n' +
          '*Ce salon sera supprimé dans quelques secondes.*';
        break;
      case 'existing_channel':
        title = '🔍 Salon Existant Détecté';
        description =
          '**Un salon utilisable a été trouvé sur le serveur.**\n\n' +
          `• Salon détecté: ${existingChannel ? existingChannel.toString() : 'Salon principal'}\n` +
          '• Le serveur reste fonctionnel\n' +
          '• Aucune restauration supplémentaire nécessaire\n\n' +
          '*Ce salon sera supprimé dans quelques secondes.*';
        color = embedColor;
        break;

      case 'minimal_channel':
        title = "🚑 Salon d'Urgence Créé";
        description =
          '**Un salon minimal a été créé en dernier recours.**\n\n' +
          "• Le serveur dispose maintenant d'un salon de base\n" +
          '• Fonctionnalité minimale assurée\n' +
          '• Recréation manuelle des autres salons recommandée\n\n' +
          '*Ce salon sera supprimé dans quelques secondes.*';
        break;
    }

    await emergencyChannel.send({
      embeds: [
        {
          color: color,
          title: title,
          description: description,
          timestamp: new Date(),
          footer: {
            text: 'GLaDOS Protection System',
          },
        },
      ],
    });
  } catch {}
}

async function sendRestorationFailureMessage(emergencyChannel) {
  if (!emergencyChannel || !emergencyChannel.isTextBased()) return;

  try {
    await emergencyChannel.send({
      embeds: [
        {
          color: embedColor,
          title: '💀 Échec de Restauration',
          description:
            '**Impossible de restaurer ou créer des salons.**\n\n' +
            '• Vérifiez les permissions de GLaDOS\n' +
            '• Le bot a besoin de "Gérer les salons"\n' +
            '• Recréation manuelle nécessaire\n' +
            '• Les bots malveillants ont été bannis\n\n' +
            '*Ce salon restera actif pour assistance.*',
          timestamp: new Date(),
          footer: {
            text: 'GLaDOS Protection System - Assistance requise',
          },
        },
      ],
    });
  } catch {}
}

function getRaidStatistics(guildId) {
  try {
    const deletedChannels = getDeletedChannelsData(guildId);
    const now = Date.now();

    const recentDeletions = deletedChannels.filter(
      (deletion) => now - deletion.timestamp < TIME_WINDOW,
    );

    return {
      totalDeletions: deletedChannels.length,
      recentDeletions: recentDeletions.length,
      timeWindow: TIME_WINDOW,
      threshold: MASS_DELETE_THRESHOLD,
      isRaidActive: recentDeletions.length >= MASS_DELETE_THRESHOLD,
      lastDeletion:
        deletedChannels.length > 0 ?
          deletedChannels[deletedChannels.length - 1]
        : null,
    };
  } catch (error) {
    return {
      totalDeletions: 0,
      recentDeletions: 0,
      timeWindow: TIME_WINDOW,
      threshold: MASS_DELETE_THRESHOLD,
      isRaidActive: false,
      lastDeletion: null,
      error: error.message,
    };
  }
}

export {
  analyzeRecentDeletions,
  banMaliciousBot,
  checkForPotentialComboRaid,
  createEmergencyChannel,
  deleteAllChannelsCreatedByBot,
  getCreatedChannelsByBotData,
  getDeletedChannelsData,
  getRaidStatistics,
  handleChannelDeleteRaid,
  handleMaliciousOwner,
  isServerCritical,
  isUserBot,
  MASS_DELETE_THRESHOLD,
  monitorRealTimeChannelCreations,
  sendComboRaidReport,
  sendOwnerRaidReport,
  sendRestorationFailureMessage,
  sendRestorationFallbackMessage,
  sendRestorationSuccessMessage,
  startServerRestoration,
  TIME_WINDOW,
  triggerEmergencyAntiRaid,
};

export default {
  analyzeRecentDeletions,
  banMaliciousBot,
  checkForPotentialComboRaid,
  createEmergencyChannel,
  deleteAllChannelsCreatedByBot,
  getCreatedChannelsByBotData,
  getDeletedChannelsData,
  getRaidStatistics,
  handleChannelDeleteRaid,
  handleMaliciousOwner,
  isServerCritical,
  isUserBot,
  MASS_DELETE_THRESHOLD,
  monitorRealTimeChannelCreations,
  sendComboRaidReport,
  sendOwnerRaidReport,
  sendRestorationFailureMessage,
  sendRestorationFallbackMessage,
  sendRestorationSuccessMessage,
  startServerRestoration,
  TIME_WINDOW,
  triggerEmergencyAntiRaid,
};

