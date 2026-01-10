import { AuditLogEvent } from 'discord.js';
import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';

import {
  isBotMalicious,
  isBotWhitelisted,
  markBotAsMalicious,
  recordChannelCreationByBot,
} from './antiRaidCoordinator.js';

import triggerErrorEmbed from './triggerErrorEmbed.js';

const ultraFastCache = new Map();
const instantBotBlacklist = new Set();
const channelCreationBuffer = new Map();

const ULTRA_FAST_THRESHOLDS = {
  DETECTION_TIME: 5,
  NEUTRALIZATION_TIME: 25,
  DELETION_TIME: 10,
  TOTAL_RESPONSE_TIME: 50,
  PRIORITY_RESPONSE_TIME: 30,
  LIGHTNING_RESPONSE_TIME: 25,
  PATTERN_CHECK_TIME: 3,
};

const performanceMetrics = {
  detectionTimes: [],
  neutralizationTimes: [],
  totalDetections: 0,
  totalNeutralizations: 0,
  averageDetectionTime: 0,
  averageNeutralizationTime: 0,
};

function recordPerformanceMetric(type, timeMs) {
  const metrics =
    type === 'detection' ?
      performanceMetrics.detectionTimes
    : performanceMetrics.neutralizationTimes;
  const totalKey =
    type === 'detection' ? 'totalDetections' : 'totalNeutralizations';
  const averageKey =
    type === 'detection' ? 'averageDetectionTime' : 'averageNeutralizationTime';

  metrics.push(timeMs);
  performanceMetrics[totalKey]++;
  if (metrics.length > 100) metrics.splice(0, metrics.length - 100);
  performanceMetrics[averageKey] =
    metrics.reduce((a, b) => a + b, 0) / metrics.length;
}

function getPerformanceStats() {
  const { detectionTimes, neutralizationTimes } = performanceMetrics;
  return {
    ...performanceMetrics,
    lastDetectionTime: detectionTimes[detectionTimes.length - 1] || 0,
    lastNeutralizationTime:
      neutralizationTimes[neutralizationTimes.length - 1] || 0,
    minDetectionTime: Math.min(...detectionTimes) || 0,
    maxDetectionTime: Math.max(...detectionTimes) || 0,
    minNeutralizationTime: Math.min(...neutralizationTimes) || 0,
    maxNeutralizationTime: Math.max(...neutralizationTimes) || 0,
  };
}

async function instantChannelCreateDetection(channel) {
  const startTime = process.hrtime.bigint();
  try {
    if (!channel?.guild?.available) return false;

    const guildId = channel.guild.id;
    const cacheKey = `${guildId}_instant_check`;
    let auditData = ultraFastCache.get(cacheKey);
    if (!auditData || Date.now() - auditData.timestamp > 50) {
      const auditPromise = channel.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.ChannelCreate,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Audit timeout')),
          ULTRA_FAST_THRESHOLDS.DETECTION_TIME,
        ),
      );
      try {
        const auditLogs = await Promise.race([auditPromise, timeoutPromise]);
        auditData = { entry: auditLogs.entries.first(), timestamp: Date.now() };
        ultraFastCache.set(cacheKey, auditData);
        setTimeout(() => ultraFastCache.delete(cacheKey), 100);
      } catch {
        return await fallbackInstantDetection(channel);
      }
    }

    const creatorId = auditData.entry?.executor?.id;
    const isBot = auditData.entry?.executor?.bot;
    if (!creatorId || !isBot) return false;

    if (await isBotWhitelisted(creatorId, channel.guild.client)) return false;

    if (instantBotBlacklist.has(creatorId)) {
      await deleteChannelInstantly(channel, 'Bot sur blacklist instantanée');
      return true;
    }

    if (isBotMalicious(creatorId)) {
      await deleteChannelInstantly(channel, 'Bot malveillant connu');
      instantBotBlacklist.add(creatorId);
      await triggerUltraFastNeutralization(channel, creatorId);
      return true;
    }

    const detectionTime = Number(process.hrtime.bigint() - startTime) / 1000000;
    recordPerformanceMetric('detection', detectionTime);
    updateChannelCreationBuffer(guildId, creatorId, channel, detectionTime);

    if (checkUltraFastThreshold(guildId, creatorId)) {
      await triggerUltraFastNeutralization(channel, creatorId);
      return true;
    }

    return false;
  } catch {
    return await fallbackInstantDetection(channel);
  }
}

async function fallbackInstantDetection(channel) {
  try {
    if (isChannelSuspiciousPattern(channel)) return true;

    const recentChannels = channel.guild.channels.cache.filter(
      (c) =>
        c.type === 0 &&
        Date.now() - c.createdTimestamp <
          ANTI_RAID_CONFIG.MASS_CREATE.TIME_WINDOW,
    );

    if (
      recentChannels.size >= Math.max(5, ANTI_RAID_CONFIG.MASS_CREATE.THRESHOLD)
    ) {
      await deleteChannelInstantly(
        channel,
        'Création rapide détectée - fallback instantané',
      );
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function deleteChannelInstantly(channel, reason) {
  try {
    if (!channel || !channel.guild) return false;

    const freshChannel = channel.guild.channels.cache.get(channel.id);
    if (!freshChannel) return true;

    const auditLogs = await channel.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelCreate,
    });
    const auditEntry = auditLogs.entries.first();

    if (auditEntry?.executor?.bot) {
      const creatorId = auditEntry.executor.id;
      if (await isBotWhitelisted(creatorId, channel.guild.client)) return false;
    }

    await freshChannel.delete(`GLaDOS Ultra-Fast: ${reason}`);
    return true;
  } catch (error) {
    if (error.code === 10003) return true;
    else return false;
  }
}

function isChannelSuspiciousPattern(channel) {
  const suspiciousPatterns = [
    /^(raid|spam|hack|nuke|delete|destroy|bot)/i,
    /^(test|temp|temporary|channel)/i,
    /[0-9]{6,}/,
    /^[\w\-_]*\d{3,}$/,
    /^.{1,2}$/,
    /^[^a-zA-Z]*$/,
    /^(general|chat|random|main|public)\d+$/i,
    /^(salon|channel|canal)\d+$/i,
    /^(text|voice|txt)\d+$/i,
    /(.)\1{4,}/,
    /^[^\w\s]*$/,
    /[\u{1F000}-\u{1F9FF}]{3,}/u,
    /[^\u0020-\u007E]{5,}/,
    /^(crash|flood|ddos|attack|exploit)/i,
    /^(auto|generated|created|made)\d*$/i,
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(channel.name));
}

function updateChannelCreationBuffer(guildId, botId, channel, detectionTime) {
  const key = `${guildId}_${botId}`;
  const now = Date.now();

  if (!channelCreationBuffer.has(key)) {
    channelCreationBuffer.set(key, []);
  }

  const buffer = channelCreationBuffer.get(key);
  buffer.push({
    channelId: channel.id,
    channelName: channel.name,
    timestamp: now,
    detectionTime,
  });

  const timeWindow = ANTI_RAID_CONFIG.MASS_CREATE.TIME_WINDOW;
  const filtered = buffer.filter((entry) => now - entry.timestamp < timeWindow);
  channelCreationBuffer.set(key, filtered);

  recordChannelCreationByBot(channel.guild, botId, channel.id, channel.name);
}

function checkUltraFastThreshold(guildId, botId) {
  const key = `${guildId}_${botId}`;
  const buffer = channelCreationBuffer.get(key) || [];
  return buffer.length >= Math.max(5, ANTI_RAID_CONFIG.MASS_CREATE.THRESHOLD);
}

async function triggerUltraFastNeutralization(channel, botId) {
  const guildId = channel.guild.id;
  const neutralizationStart = process.hrtime.bigint();
  try {
    if (await isBotWhitelisted(botId, channel.guild.client)) return false;

    instantBotBlacklist.add(botId);
    markBotAsMalicious(botId, true, true);

    const banResult = await banBotUltraFast(channel.guild, botId);

    const neutralizationEnd = process.hrtime.bigint();
    const neutralizationTime =
      Number(neutralizationEnd - neutralizationStart) / 1000000;

    await deleteChannelInstantly(channel, 'Déclencheur raid détecté');

    setImmediate(async () => {
      try {
        await removeAllBotPermissionsUltraFast(channel.guild, botId);
      } catch (e) {
        triggerErrorEmbed(e, {
          source: 'ultraFastRaidDetection.js',
          action: 'removeAllBotPermissionsUltraFast',
        });
      }
    });

    recordPerformanceMetric('neutralization', neutralizationTime);

    setImmediate(() =>
      sendUltraFastAlert(channel.guild, botId, neutralizationTime, [
        { value: true },
        { value: 1 },
        { value: banResult },
      ]),
    );

    const key = `${guildId}_${botId}`;
    channelCreationBuffer.delete(key);

    return true;
  } catch (e) {
    triggerErrorEmbed(e, {
      source: 'ultraFastRaidDetection.js',
      action: 'triggerUltraFastNeutralization',
    });
    return false;
  }
}

async function removeAllBotPermissionsUltraFast(guild, botId) {
  try {
    const member = await guild.members.fetch(botId).catch(() => null);
    if (!member) return false;

    const removeRolePromises = member.roles.cache
      .filter((role) => role.id !== guild.id)
      .map((role) =>
        member.roles.remove(
          role,
          'GLaDOS Ultra-Fast: Retrait permissions bot malveillant',
        ),
      );

    await Promise.allSettled(removeRolePromises);

    return true;
  } catch (e) {
    triggerErrorEmbed(e, {
      source: 'ultraFastRaidDetection.js',
      action: 'removeAllBotPermissionsUltraFast',
    });
    return false;
  }
}

async function deleteAllChannelsCreatedByBotUltraFast(guild, botId) {
  try {
    try {
      await guild.channels.fetch();
    } catch (fetchError) {
      triggerErrorEmbed(fetchError, {
        source: 'ultraFastRaidDetection.js',
        action: 'deleteAllChannelsCreatedByBotUltraFast',
      });
    }

    const key = `${guild.id}_${botId}`;
    const createdChannels = channelCreationBuffer.get(key) || [];

    if (createdChannels.length === 0) return 0;

    const deletionPromises = createdChannels.map(async (channelData) => {
      const channel = guild.channels.cache.get(channelData.channelId);
      if (channel) {
        try {
          await channel.delete(
            'GLaDOS Ultra-Fast: Suppression salon malveillant',
          );
          return { success: true, channelId: channelData.channelId };
        } catch (error) {
          if (error.code === 10003) {
            return {
              success: true,
              channelId: channelData.channelId,
              alreadyDeleted: true,
            };
          }
          return { success: false, error: error.message };
        }
      }
    });

    const results = await Promise.allSettled(deletionPromises);
    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success,
    ).length;

    return successCount;
  } catch (e) {
    triggerErrorEmbed(e, {
      source: 'ultraFastRaidDetection.js',
      action: 'deleteAllChannelsCreatedByBotUltraFast',
    });
  }
}

async function banBotUltraFast(guild, botId) {
  try {
    if (await isBotWhitelisted(botId, guild.client)) return false;

    await guild.bans.create(botId, {
      reason: 'GLaDOS Ultra-Fast: Création massive de salons détectée',
    });

    return true;
  } catch (e) {
    triggerErrorEmbed(e, {
      source: 'ultraFastRaidDetection.js',
      action: 'banBotUltraFast',
    });
    return false;
  }
}

async function sendUltraFastAlert(guild, botId, neutralizationTime, results) {
  try {
    if (!guild || !guild.available) return;

    const raidChannel = guild.channels.cache.find(
      (c) =>
        c.type === 0 &&
        c
          .permissionsFor(guild.members.me)
          ?.has(['SendMessages', 'ViewChannel']) &&
        (ANTI_RAID_CONFIG.RESOURCES.MAIN_CHANNEL_PATTERNS.some((term) =>
          c.name.toLowerCase().includes(term),
        ) ||
          c.name.includes('💬')),
    );

    if (raidChannel) {
      const alertEmbed = {
        color: 0xff4444,
        title: '⚡ RAID ULTRA-RAPIDE NEUTRALISÉ',
        description:
          `> <a:warning:1269193959503040553> **Bot malveillant détecté et neutralisé en ${neutralizationTime.toFixed(2)}ms**\n` +
          `> <a:interdit:1269193896790065152> **Bot ID:** \`${botId}\`\n` +
          `> <a:valider:1298662697185050634> **Protection ultra-rapide activée** - Création massive stoppée\n\n` +
          `**Actions exécutées:**\n` +
          `${results[0]?.value ? '✅' : '❌'} Permissions retirées\n` +
          `✅ ${results[1]?.value || 0} salons supprimés\n` +
          `${results[2]?.value ? '✅' : '❌'} Bot banni\n\n` +
          `**Temps de réaction: ${neutralizationTime < 200 ? '🚀 ULTRA-RAPIDE' : '⚡ RAPIDE'}**`,
        timestamp: new Date(),
        footer: { text: 'GLaDOS Ultra-Fast Protection' },
      };

      await raidChannel
        .send({
          embeds: [alertEmbed],
          files: [
            {
              attachment: ANTI_RAID_CONFIG.RESOURCES.ANTI_RAID_IMAGE_URL,
              name: 'ultra-raid.png',
            },
          ],
        })
        .catch(() => {});
    }
  } catch (e) {
    triggerErrorEmbed(e, {
      source: 'ultraFastRaidDetection.js',
      action: 'sendUltraFastAlert',
    });
  }
}

function cleanupUltraFastCaches() {
  const now = Date.now();
  const maxAge = 60000;

  for (const [key, data] of ultraFastCache.entries()) {
    if (now - data.timestamp > maxAge) {
      ultraFastCache.delete(key);
    }
  }

  for (const [key, buffer] of channelCreationBuffer.entries()) {
    const timeWindow = ANTI_RAID_CONFIG.MASS_CREATE.TIME_WINDOW;
    const filtered = buffer.filter(
      (entry) => now - entry.timestamp < timeWindow,
    );
    if (filtered.length === 0) {
      channelCreationBuffer.delete(key);
    } else channelCreationBuffer.set(key, filtered);
  }
}

async function scheduleDelayedChannelCleanup(guild, botId, delay = 5000) {
  try {
    if (!guild || !guild.available || !botId) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (!isBotMalicious(botId)) {
      return;
    }

    const key = `${guild.id}_${botId}`;
    const createdChannels = channelCreationBuffer.get(key) || [];

    if (createdChannels.length === 0) {
      return;
    }

    const deletionPromises = createdChannels.map(async (channelData) => {
      try {
        const channel = guild.channels.cache.get(channelData.channelId);
        if (channel) {
          await channel.delete('GLaDOS: Nettoyage différé - Bot malveillant');
          return { deleted: true };
        } else {
          return { alreadyDeleted: true };
        }
      } catch (error) {
        if (error.code === 10003) {
          return { alreadyDeleted: true };
        } else {
          return { failed: true };
        }
      }
    });

    const deletionResults = await Promise.allSettled(deletionPromises);
    let deleted = 0,
      alreadyDeleted = 0,
      failed = 0;
    for (const result of deletionResults) {
      if (result.status === 'fulfilled') {
        if (result.value.deleted) deleted++;
        else if (result.value.alreadyDeleted) alreadyDeleted++;
        else if (result.value.failed) failed++;
      } else {
        failed++;
      }
    }

    channelCreationBuffer.delete(key);

    console.log(
      `[Delayed Cleanup] Bot ${botId} sur ${guild.id}: ${deleted} supprimés, ${alreadyDeleted} déjà supprimés, ${failed} échecs`,
    );
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'ultraFastRaidDetection.js',
      action: 'scheduleDelayedChannelCleanup',
      guildId: guild?.id,
      botId,
    });
  }
}

setInterval(cleanupUltraFastCaches, 5000);

export {
  banBotUltraFast,
  cleanupUltraFastCaches,
  deleteAllChannelsCreatedByBotUltraFast,
  deleteChannelInstantly,
  getPerformanceStats,
  instantChannelCreateDetection,
  isChannelSuspiciousPattern,
  recordPerformanceMetric,
  removeAllBotPermissionsUltraFast,
  scheduleDelayedChannelCleanup,
  triggerUltraFastNeutralization,
  ULTRA_FAST_THRESHOLDS,
};

