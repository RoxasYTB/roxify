import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import whitelist from '../whitelist.json' with { type: 'json' };
import { hasReportBeenSentRecently } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const guildRaidStates = new Map();

const maliciousBots = new Map();

const watchedBots = new Map();

const centralRaidData = {
  deletedChannels: {},
  createdChannelsByBot: {},
  lastReportTime: {},
};

const emergencyChannelCreations = new Map();

const ongoingRestorations = new Map();

const maliciousOwners = new Map();

const comboRaidStates = new Map();

const suspiciousActivity = new Map();

const antiPubDisabledGuilds = new Map();

const fastLookupCache = new Map();
const predictionCache = new Map();

const antiNukeLocks = new Map();

import { UserFlagsBitField } from 'discord.js';

function isBotMalicious(botId) {
  const cacheKey = `malicious_${botId}`;
  const cached = fastLookupCache.get(cacheKey);

  if (cached !== undefined && Date.now() - cached.timestamp < 5000) {
    return cached.value;
  }

  const result = maliciousBots.has(botId);
  fastLookupCache.set(cacheKey, {
    value: result,
    timestamp: Date.now(),
  });

  if (fastLookupCache.size > 1000) {
    const now = Date.now();
    for (const [key, data] of fastLookupCache.entries()) {
      if (now - data.timestamp > 10000) {
        fastLookupCache.delete(key);
      }
    }
  }

  return result;
}

function isValidUserId(userId) {
  return userId && typeof userId === 'string' && /^\d{17,19}$/.test(userId);
}

async function isBotWhitelisted(botId, client = null) {
  if (!isValidUserId(botId)) return false;

  if (whitelist.WhitelistedBots.includes(botId)) {
    return true;
  }

  if (client && client.user && client.user.id === botId) {
    return true;
  }
  if (client && client.users && typeof client.users.fetch === 'function') {
    try {
      const user = await client.users.fetch(botId).catch(() => null);
      if (user) {
        const isVerifiedBot =
          user.flags?.has(UserFlagsBitField.Flags.VerifiedBot) || false;
        if (isVerifiedBot) {
          return true;
        }
      }
    } catch (sendError) {
      triggerErrorEmbed(
        sendError,
        client.client?.user?.username,
        client.client?.user?.displayAvatarURL(),
      );
    }
  }

  return false;
}

function markBotAsMalicious(botId, persistent = false, client = null) {
  if (!isValidUserId(botId)) {
    return false;
  }

  if (isBotWhitelisted(botId, client)) {
    return false;
  }

  const now = Date.now();
  const existingData = maliciousBots.get(botId);

  maliciousBots.set(botId, {
    timestamp: now,
    persistent: persistent,
    attackCount: (existingData?.attackCount || 0) + 1,
    lastAttack: now,
    threatLevel: calculateThreatLevel(
      existingData?.attackCount || 0,
      persistent,
    ),
  });

  fastLookupCache.delete(`malicious_${botId}`);

  if (ANTI_RAID_CONFIG.MONITORING.PREDICTION_ENABLED) {
    updateAttackPrediction(botId, now);
  }

  if (!persistent) {
    const cleanupDelay = Math.max(
      ANTI_RAID_CONFIG.GENERAL.MALICIOUS_BOT_CLEANUP / 2,
      60000,
    );

    setTimeout(() => {
      const botData = maliciousBots.get(botId);
      if (
        botData &&
        !botData.persistent &&
        Date.now() - botData.lastAttack > cleanupDelay
      ) {
        maliciousBots.delete(botId);
        fastLookupCache.delete(`malicious_${botId}`);
      }
    }, cleanupDelay);
  }

  return true;
}

function calculateThreatLevel(attackCount, persistent) {
  if (persistent && attackCount > 3) return 'critical';
  if (attackCount > 2) return 'high';
  if (attackCount > 1) return 'medium';
  return 'low';
}

function updateAttackPrediction(botId, timestamp) {
  const key = `predict_${botId}`;
  const existing = predictionCache.get(key) || [];

  existing.push(timestamp);
  if (existing.length > 10) existing.shift();

  predictionCache.set(key, existing);

  if (existing.length >= 3) {
    const intervals = [];
    for (let i = 1; i < existing.length; i++) {
      intervals.push(existing[i] - existing[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    if (avgInterval < 30000) {
      const botData = maliciousBots.get(botId);
      if (botData) {
        botData.threatLevel = 'critical';
        botData.persistent = true;
        maliciousBots.set(botId, botData);
      }
    }
  }
}

function getMaliciousBots() {
  return Array.from(maliciousBots.keys()).filter(isValidUserId);
}

function recordChannelCreationByBot(guild, botId, channelId, channelName) {
  const guildId = guild.id;
  const now = Date.now();

  if (!centralRaidData.createdChannelsByBot[guildId]) {
    centralRaidData.createdChannelsByBot[guildId] = {};
  }

  if (!centralRaidData.createdChannelsByBot[guildId][botId]) {
    centralRaidData.createdChannelsByBot[guildId][botId] = [];
  }

  const existingChannel = centralRaidData.createdChannelsByBot[guildId][
    botId
  ].find((c) => c.channelId === channelId);

  if (!existingChannel) {
    centralRaidData.createdChannelsByBot[guildId][botId].push({
      channelId,
      channelName,
      timestamp: now,
    });
  }
}

function getRaidStatistics(guildId) {
  const now = Date.now();
  const TIME_WINDOW = ANTI_RAID_CONFIG.MASS_DELETE.TIME_WINDOW;

  const deletionStats = (centralRaidData.deletedChannels[guildId] || []).filter(
    (deletion) => now - deletion.timestamp < TIME_WINDOW,
  );

  const creationStats = {};
  if (centralRaidData.createdChannelsByBot[guildId]) {
    Object.keys(centralRaidData.createdChannelsByBot[guildId]).forEach(
      (botId) => {
        creationStats[botId] = centralRaidData.createdChannelsByBot[guildId][
          botId
        ].filter((creation) => now - creation.timestamp < TIME_WINDOW).length;
      },
    );
  }

  return {
    recentDeletions: deletionStats.length,
    deletionsByBot: deletionStats.reduce((acc, deletion) => {
      acc[deletion.deletorId] = (acc[deletion.deletorId] || 0) + 1;
      return acc;
    }, {}),
    recentCreationsByBot: creationStats,
    maliciousBots: Array.from(maliciousBots.keys()),
    isRaidDetected:
      deletionStats.length >= ANTI_RAID_CONFIG.MASS_DELETE.THRESHOLD ||
      Object.values(creationStats).some(
        (count) => count >= ANTI_RAID_CONFIG.MASS_CREATE.THRESHOLD,
      ),
  };
}

function recordChannelDeletion(guildId, deletionData) {
  if (!centralRaidData.deletedChannels[guildId]) {
    centralRaidData.deletedChannels[guildId] = [];
  }
  centralRaidData.deletedChannels[guildId].push(deletionData);
}

function cleanupRaidData(guildId = null) {
  const now = Date.now();
  const TIME_WINDOW = ANTI_RAID_CONFIG.MASS_DELETE.TIME_WINDOW;
  const maxAge = TIME_WINDOW * 5;

  if (guildId) {
    if (centralRaidData.deletedChannels[guildId]) {
      centralRaidData.deletedChannels[guildId] =
        centralRaidData.deletedChannels[guildId].filter(
          (deletion) => now - deletion.timestamp < maxAge,
        );
      if (centralRaidData.deletedChannels[guildId].length === 0) {
        delete centralRaidData.deletedChannels[guildId];
      }
    }
  } else {
    Object.keys(centralRaidData.deletedChannels).forEach((id) => {
      centralRaidData.deletedChannels[id] = centralRaidData.deletedChannels[
        id
      ].filter((deletion) => now - deletion.timestamp < maxAge);
      if (centralRaidData.deletedChannels[id].length === 0) {
        delete centralRaidData.deletedChannels[id];
      }
    });
  }
}

function initializeGuildRaidState(guildId) {
  if (!guildRaidStates.has(guildId)) {
    guildRaidStates.set(guildId, {
      isUnderAttack: false,
      attackType: null,
      attackStartTime: null,
      maliciousBotsDetected: new Set(),
      actionsBlocked: 0,
      lastCleanupTime: Date.now(),
    });
  }
  return guildRaidStates.get(guildId);
}

function markGuildUnderAttack(guildId, attackType, botId) {
  const state = initializeGuildRaidState(guildId);

  if (!state.isUnderAttack) {
    state.isUnderAttack = true;
    state.attackType = attackType;
    state.attackStartTime = Date.now();
  } else if (state.attackType !== attackType) {
    state.attackType = 'combo';
  }

  state.maliciousBotsDetected.add(botId);
  markBotAsMalicious(botId);
}

function markGuildSecure(guildId, force = false) {
  const state = guildRaidStates.get(guildId);
  if (!state) return;

  let hasPersistentThreats = false;

  if (state.maliciousBotsDetected) {
    for (const botId of state.maliciousBotsDetected) {
      const botData = maliciousBots.get(botId);
      if (botData && botData.persistent) {
        hasPersistentThreats = true;
        break;
      }
    }
  }

  if (hasPersistentThreats && !force) {
    state.attackType = 'persistent_threat';
    state.lastThreatCheck = Date.now();

    return false;
  }

  state.isUnderAttack = false;
  state.attackType = null;
  state.attackStartTime = null;

  setTimeout(() => {
    cleanupGuildRaidState(guildId);
  }, ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL);

  return true;
}

function isGuildUnderAttack(guildId) {
  const state = guildRaidStates.get(guildId);
  return state ? state.isUnderAttack : false;
}

function getGuildAttackState(guildId) {
  return guildRaidStates.get(guildId) || null;
}

function markOwnerAsMalicious(ownerId, guildId, isBot = false) {
  if (!isBot) {
    return false;
  }

  maliciousOwners.set(ownerId, {
    guildId,
    timestamp: Date.now(),
    cannotBeBanned: true,
    isBot: true,
  });

  markBotAsMalicious(ownerId, true);

  return true;
}

function recordBlockedAction(guildId) {
  const state = initializeGuildRaidState(guildId);
  state.actionsBlocked += 1;
}

function shouldBlockBotAction(
  guildId,
  botId,
  action,
  isBot = true,
  client = null,
) {
  if (!isBot) {
    return false;
  }

  if (isBotWhitelisted(botId, client)) {
    return false;
  }

  if (isBotMalicious(botId)) {
    recordBlockedAction(guildId, action, botId, true);
    return true;
  }

  const state = guildRaidStates.get(guildId);
  if (state && state.isUnderAttack && state.maliciousBotsDetected.has(botId)) {
    recordBlockedAction(guildId, action, botId, true);
    return true;
  }

  return false;
}

function recordSuspiciousActivity(
  guildId,
  botId,
  activityType,
  count,
  isBot = true,
) {
  if (!isBot) {
    return;
  }

  const key = `${guildId}_${botId}`;

  if (!suspiciousActivity.has(key)) {
    suspiciousActivity.set(key, {
      guildId,
      botId,
      deletions: 0,
      creations: 0,
      firstActivity: Date.now(),
      lastActivity: Date.now(),
      isBot: true,
    });
  }

  const activity = suspiciousActivity.get(key);

  if (activityType === 'deletion') {
    activity.deletions += count;
  } else if (activityType === 'creation') {
    activity.creations += count;
  }

  activity.lastActivity = Date.now();
}

function markBotForEnhancedMonitoring(guildId, botId) {
  const key = `enhanced_${guildId}_${botId}`;

  suspiciousActivity.set(key, {
    guildId,
    botId,
    enhanced: true,
    timestamp: Date.now(),
    isBot: true,
  });
}

function isComboRaidInProgress(guildId, botId) {
  const key = `${guildId}_${botId}`;
  return comboRaidStates.has(key);
}

function markComboRaidDetected(guildId, botId) {
  const key = `${guildId}_${botId}`;

  comboRaidStates.set(key, {
    guildId,
    botId,
    startTime: Date.now(),
    deletionsDetected: 0,
    creationsDetected: 0,
    phase: 'deletion',
  });

  setTimeout(() => {
    comboRaidStates.delete(key);
  }, ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL);
}

function getComboRaidState(guildId, botId) {
  const key = `${guildId}_${botId}`;
  return comboRaidStates.get(key) || null;
}

function updateComboRaidState(guildId, botId, phase, data = {}) {
  const key = `${guildId}_${botId}`;
  const state = comboRaidStates.get(key);

  if (state) {
    state.phase = phase;
    state.lastUpdate = Date.now();

    if (data.deletions) state.deletionsDetected += data.deletions;
    if (data.creations) state.creationsDetected += data.creations;
  }
}

function getAllChannelsCreatedByBot(guildId, botId) {
  if (
    centralRaidData.createdChannelsByBot[guildId] &&
    centralRaidData.createdChannelsByBot[guildId][botId]
  ) {
    return centralRaidData.createdChannelsByBot[guildId][botId];
  }
  return [];
}

function waitForChannelCreationToStop(guildId, botId, maxWaitTime = 10000) {
  return new Promise((resolve) => {
    const checkInterval = 1000;
    let elapsedTime = 0;
    let lastCreationCount = 0;
    let stableCount = 0;

    const intervalId = setInterval(() => {
      const channels = getAllChannelsCreatedByBot(guildId, botId);
      const currentCount = channels.length;

      if (currentCount === lastCreationCount) {
        stableCount++;

        if (stableCount >= 3) {
          clearInterval(intervalId);
          resolve(true);
          return;
        }
      } else {
        stableCount = 0;
        lastCreationCount = currentCount;
      }

      elapsedTime += checkInterval;

      if (elapsedTime >= maxWaitTime) {
        clearInterval(intervalId);
        resolve(false);
      }
    }, checkInterval);
  });
}

function getSuspiciousActivityReport(guildId) {
  const activities = [];

  for (const [, activity] of suspiciousActivity.entries()) {
    if (activity.guildId === guildId) {
      activities.push({
        botId: activity.botId,
        deletions: activity.deletions,
        creations: activity.creations,
        duration: activity.lastActivity - activity.firstActivity,
        isActive: Date.now() - activity.lastActivity < 30000,
      });
    }
  }

  return {
    guildId,
    activitiesCount: activities.length,
    activities,
    hasActiveThreats: activities.some((a) => a.isActive),
  };
}

function setAntiPubDisabled(guildId, disabled) {
  if (disabled) {
    antiPubDisabledGuilds.set(guildId, {
      timestamp: Date.now(),
      reason: 'raid_in_progress',
    });
  } else {
    antiPubDisabledGuilds.delete(guildId);
  }
}

function isAntiPubDisabled(guildId) {
  return antiPubDisabledGuilds.has(guildId);
}

function cleanupAntiPubDisabled() {
  const now = Date.now();
  const MAX_DISABLE_TIME = 30000;

  for (const [guildId, data] of antiPubDisabledGuilds.entries()) {
    if (now - data.timestamp > MAX_DISABLE_TIME) {
      antiPubDisabledGuilds.delete(guildId);
    }
  }
}

function performGlobalCleanup() {
  const now = Date.now();
  const staleThreshold = ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL * 2;
  const emergencyTimeout = 5000;

  for (const [guildId, state] of guildRaidStates.entries()) {
    if (
      !state.isUnderAttack &&
      now - (state.lastCleanupTime || 0) > staleThreshold
    ) {
      cleanupGuildRaidState(guildId);
    }

    if (
      state.attackType === 'persistent_threat' &&
      now - (state.lastThreatCheck || 0) > 300000
    ) {
      const stillHasThreats = checkForPersistentThreats(guildId);
      if (!stillHasThreats) {
        markGuildSecure(guildId, true);
      } else {
        state.lastThreatCheck = now;
      }
    }
  }

  for (const [botId, data] of maliciousBots.entries()) {
    if (
      !data.persistent &&
      now - data.timestamp > ANTI_RAID_CONFIG.GENERAL.MALICIOUS_BOT_CLEANUP
    ) {
      maliciousBots.delete(botId);
    }
  }

  cleanupRaidData();

  for (const [guildId, data] of emergencyChannelCreations.entries()) {
    if (now - data.timestamp > emergencyTimeout) {
      emergencyChannelCreations.delete(guildId);
    }
  }

  for (const [guildId, data] of ongoingRestorations.entries()) {
    if (now - data.timestamp > emergencyTimeout * 2) {
      ongoingRestorations.delete(guildId);
    }
  }

  for (const [ownerId, data] of maliciousOwners.entries()) {
    if (now - data.timestamp > ANTI_RAID_CONFIG.GENERAL.MALICIOUS_BOT_CLEANUP) {
      maliciousOwners.delete(ownerId);
    }
  }

  for (const [key, state] of comboRaidStates.entries()) {
    if (
      now - state.startTime >
      ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL
    ) {
      comboRaidStates.delete(key);
    }
  }

  cleanupSuspiciousActivities();

  cleanupAntiPubDisabled();
}

setInterval(
  performGlobalCleanup,
  ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL,
);

function isGuildInCriticalState(guild) {
  const usableChannels = guild.channels.cache.filter(
    (c) => ![15, 4].includes(c.type),
  );

  const minChannels =
    guild.features?.includes('COMMUNITY') ?
      ANTI_RAID_CONFIG.EMERGENCY.MIN_CHANNELS_COMMUNITY
    : ANTI_RAID_CONFIG.EMERGENCY.MIN_CHANNELS_NORMAL;

  return usableChannels.size <= minChannels;
}

function markGuildCritical(guildId, botId) {
  const state = initializeGuildRaidState(guildId);

  state.isUnderAttack = true;
  state.attackType = 'critical';
  state.attackStartTime = Date.now();
  state.maliciousBotsDetected.add(botId);

  markBotAsMalicious(botId);
}

function checkForPersistentThreats(guildId) {
  const state = guildRaidStates.get(guildId);
  if (!state || !state.maliciousBotsDetected) return false;

  for (const botId of state.maliciousBotsDetected) {
    const botData = maliciousBots.get(botId);
    if (botData && botData.persistent) {
      return true;
    }
  }

  return false;
}

function markBotForWatching(botId, guildId) {
  const key = `${guildId}_${botId}`;
  watchedBots.set(key, {
    botId,
    guildId,
    timestamp: Date.now(),
    rebanned: false,
  });

  setTimeout(
    () => {
      watchedBots.delete(key);
    },
    24 * 60 * 60 * 1000,
  );
}

function isBotWatched(botId, guildId) {
  const key = `${guildId}_${botId}`;
  return watchedBots.has(key);
}

async function handleMaliciousBotReturn(guild, botId, action = 'join') {
  const guildId = guild.id;

  if (isBotMalicious(botId)) {
    if (action === 'attack') {
      resetBotRaidData(guildId, botId);

      markBotAsMalicious(botId, true, guild.client);

      return 'reset_data';
    } else {
      const botMember = guild.members.me;
      if (botMember.permissions.has('BanMembers')) {
        const isWhitelisted = await isBotWhitelisted(botId, guild.client);
        if (!isWhitelisted) {
          await guild.bans.create(botId, {
            reason: 'Bot malveillant connu - Rebannissement automatique GLaDOS',
          });
        }

        return 'rebanned';
      }
    }
  }

  if (isBotWatched(botId, guildId)) {
    return 'watching';
  }

  return 'none';
}

function resetBotRaidData(guildId, botId) {
  if (
    centralRaidData.createdChannelsByBot[guildId] &&
    centralRaidData.createdChannelsByBot[guildId][botId]
  ) {
    delete centralRaidData.createdChannelsByBot[guildId][botId];
  }

  for (const [key, activity] of suspiciousActivity.entries()) {
    if (activity.botId === botId && activity.guildId === guildId) {
      suspiciousActivity.delete(key);
    }
  }

  for (const [key, state] of comboRaidStates.entries()) {
    if (state.botId === botId && state.guildId === guildId) {
      comboRaidStates.delete(key);
    }
  }
}

function hasReportBeenSent(guildId, reportType, botId = null) {
  return hasReportBeenSentRecently(guildId, reportType, botId);
}

function markReportAsSent() {
  return true;
}

function getAntiRaidReport(guildId) {
  try {
    const guildState = guildRaidStates.get(guildId);
    const centralData = getCentralRaidData();

    if (!guildState) {
      return {
        guildId,
        isUnderAttack: false,
        attackType: null,
        suspiciousBotId: null,
        deletedChannels: centralData.deletedChannels[guildId]?.length || 0,
        createdChannels: Object.keys(
          centralData.createdChannelsByBot[guildId] || {},
        ).length,
        lastActivity: null,
        status: 'secure',
      };
    }

    return {
      guildId,
      isUnderAttack: guildState.isUnderAttack || false,
      attackType: guildState.attackType || null,
      suspiciousBotId: guildState.suspiciousBotId || null,
      deletedChannels: centralData.deletedChannels[guildId]?.length || 0,
      createdChannels: Object.keys(
        centralData.createdChannelsByBot[guildId] || {},
      ).length,
      lastActivity: guildState.lastActivity || null,
      status: guildState.isUnderAttack ? 'under_attack' : 'secure',
      isCritical: guildState.isCritical || false,
    };
  } catch (error) {
    return {
      guildId,
      isUnderAttack: false,
      attackType: null,
      suspiciousBotId: null,
      deletedChannels: 0,
      createdChannels: 0,
      lastActivity: null,
      status: 'error',
      error: error.message,
    };
  }
}

function cleanupSuspiciousActivities() {
  const now = Date.now();
  const maxAge = ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL;

  for (const [key, activity] of suspiciousActivity.entries()) {
    if (now - activity.lastActivity > maxAge) {
      suspiciousActivity.delete(key);
    }
  }
}

function isAntiNukeCreationInProgress(guildId) {
  return antiNukeLocks.has(guildId);
}

function lockAntiNukeCreation(guildId) {
  if (antiNukeLocks.has(guildId)) {
    return false;
  }

  antiNukeLocks.set(guildId, {
    timestamp: Date.now(),
    locked: true,
    type: 'anti_nuke_creation',
  });

  setTimeout(() => {
    antiNukeLocks.delete(guildId);
  }, 10000);

  return true;
}

function unlockAntiNukeCreation(guildId) {
  antiNukeLocks.delete(guildId);
}

function isEmergencyChannelCreationInProgress(guildId) {
  return emergencyChannelCreations.has(guildId) || antiNukeLocks.has(guildId);
}

function lockEmergencyChannelCreation(guildId) {
  if (emergencyChannelCreations.has(guildId)) {
    return false;
  }

  emergencyChannelCreations.set(guildId, {
    timestamp: Date.now(),
    locked: true,
  });

  return true;
}

function unlockEmergencyChannelCreation(guildId) {
  emergencyChannelCreations.delete(guildId);
}

function isRestorationInProgress(guildId) {
  return ongoingRestorations.has(guildId);
}

function lockRestoration(guildId) {
  if (ongoingRestorations.has(guildId)) {
    return false;
  }

  ongoingRestorations.set(guildId, {
    timestamp: Date.now(),
    locked: true,
  });

  return true;
}

function unlockRestoration(guildId) {
  ongoingRestorations.delete(guildId);
}

function findExistingEmergencyChannel(guild) {
  return guild.channels.cache.find(
    (c) =>
      c.type === 0 &&
      (c.name === 'anti-nuke' ||
        c.name === 'anti-nuke-urgence' ||
        c.name.includes('anti-nuke')),
  );
}

function isMaliciousOwner(userId) {
  return maliciousOwners.has(userId);
}

function canUserBeBanned(userId, guildId) {
  if (maliciousOwners.has(userId)) {
    const ownerData = maliciousOwners.get(userId);
    return ownerData.guildId !== guildId;
  }

  return true;
}

function cleanupGuildRaidState(guildId) {
  const state = guildRaidStates.get(guildId);
  if (state) {
    const now = Date.now();

    if (
      !state.isUnderAttack &&
      now - (state.attackStartTime || 0) >
        ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL
    ) {
      guildRaidStates.delete(guildId);
    }
  }
}

function getCentralRaidData() {
  return centralRaidData;
}

function cleanupExpiredLocks() {
  const now = Date.now();
  const LOCK_TIMEOUT = 15000;

  for (const [guildId, lockData] of antiNukeLocks.entries()) {
    if (now - lockData.timestamp > LOCK_TIMEOUT) {
      antiNukeLocks.delete(guildId);
    }
  }

  for (const [guildId, lockData] of emergencyChannelCreations.entries()) {
    if (now - lockData.timestamp > LOCK_TIMEOUT) {
      emergencyChannelCreations.delete(guildId);
    }
  }

  for (const [guildId, lockData] of ongoingRestorations.entries()) {
    if (now - lockData.timestamp > LOCK_TIMEOUT * 4) {
      ongoingRestorations.delete(guildId);
    }
  }
}

setInterval(cleanupExpiredLocks, 30000);

const addChannelCreationByBot = recordChannelCreationByBot;
function getGuildRaidState(guildId) {
  return getGuildAttackState(guildId);
}

export {
  addChannelCreationByBot,
  canUserBeBanned,
  checkForPersistentThreats,
  cleanupAntiPubDisabled,
  cleanupExpiredLocks,
  cleanupGuildRaidState,
  cleanupRaidData,
  cleanupSuspiciousActivities,
  findExistingEmergencyChannel,
  getAllChannelsCreatedByBot,
  getAntiRaidReport,
  getCentralRaidData,
  getComboRaidState,
  getGuildAttackState,
  getGuildRaidState,
  getMaliciousBots,
  getRaidStatistics,
  getSuspiciousActivityReport,
  handleMaliciousBotReturn,
  hasReportBeenSent,
  initializeGuildRaidState,
  isAntiNukeCreationInProgress,
  isAntiPubDisabled,
  isBotMalicious,
  isBotWatched,
  isBotWhitelisted,
  isComboRaidInProgress,
  isEmergencyChannelCreationInProgress,
  isGuildInCriticalState,
  isGuildUnderAttack,
  isMaliciousOwner,
  isRestorationInProgress,
  isValidUserId,
  lockAntiNukeCreation,
  lockEmergencyChannelCreation,
  lockRestoration,
  markBotAsMalicious,
  markBotForEnhancedMonitoring,
  markBotForWatching,
  markComboRaidDetected,
  markGuildCritical,
  markGuildSecure,
  markGuildUnderAttack,
  markOwnerAsMalicious,
  markReportAsSent,
  performGlobalCleanup,
  recordBlockedAction,
  recordChannelCreationByBot,
  recordChannelDeletion,
  recordSuspiciousActivity,
  resetBotRaidData,
  setAntiPubDisabled,
  shouldBlockBotAction,
  unlockAntiNukeCreation,
  unlockEmergencyChannelCreation,
  unlockRestoration,
  updateComboRaidState,
  waitForChannelCreationToStop,
};

