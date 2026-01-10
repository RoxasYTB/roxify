import { AuditLogEvent } from 'discord.js';

import {
  markBotForEnhancedMonitoring,
  recordChannelCreationByBot,
  recordSuspiciousActivity,
} from './antiRaidCoordinator.js';

import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';

const monitoringIntervals = new Map();

const enhancedMonitoring = new Map();

function monitorChannelCreations(guild, botId, duration = 30000) {
  const guildId = guild.id;
  const monitorKey = `${guildId}_${botId}`;

  if (monitoringIntervals.has(monitorKey)) {
    return;
  }

  const monitoringData = {
    guildId,
    botId,
    startTime: Date.now(),
    duration,
    creationsDetected: 0,
    lastCheck: Date.now(),
  };

  const checkInterval = ANTI_RAID_CONFIG.MONITORING?.CHECK_INTERVAL || 2000;

  const intervalId = setInterval(async () => {
    await performChannelCreationCheck(guild, botId, monitoringData);
  }, checkInterval);

  monitoringIntervals.set(monitorKey, {
    intervalId,
    data: monitoringData,
  });

  setTimeout(() => {
    stopMonitoringChannelCreations(guild, botId);
  }, duration);

  recordSuspiciousActivity(guildId, botId, 'monitoring_started', 1, true);
}

async function performChannelCreationCheck(guild, botId, monitoringData) {
  const now = Date.now();

  const auditLogs = await guild.fetchAuditLogs({
    limit: 10,
    type: AuditLogEvent.ChannelCreate,
  });

  let newCreationsDetected = 0;

  for (const entry of auditLogs.entries.values()) {
    if (
      entry.executor?.id === botId &&
      entry.createdTimestamp > monitoringData.lastCheck
    ) {
      newCreationsDetected++;

      recordChannelCreationByBot(
        guild,
        botId,
        entry.target?.id,
        entry.target?.name,
      );
    }
  }

  if (newCreationsDetected > 0) {
    monitoringData.creationsDetected += newCreationsDetected;

    recordSuspiciousActivity(
      guild.id,
      botId,
      'creation',
      newCreationsDetected,
      true,
    );

    if (
      monitoringData.creationsDetected >=
      ANTI_RAID_CONFIG.MASS_CREATE.THRESHOLD / 2
    ) {
      activateEnhancedMonitoring(guild, botId);
    }
  }

  monitoringData.lastCheck = now;
}

function activateEnhancedMonitoring(guild, botId) {
  const enhancedKey = `${guild.id}_${botId}`;

  if (enhancedMonitoring.has(enhancedKey)) {
    return;
  }

  enhancedMonitoring.set(enhancedKey, {
    guildId: guild.id,
    botId,
    startTime: Date.now(),
    immediateAction: true,
  });

  if (typeof markBotForEnhancedMonitoring === 'function') {
    markBotForEnhancedMonitoring(guild.id, botId);
  }

  setTimeout(() => {
    enhancedMonitoring.delete(enhancedKey);
  }, 600000);
}

function stopMonitoringChannelCreations(guild, botId) {
  const monitorKey = `${guild.id}_${botId}`;
  const monitoring = monitoringIntervals.get(monitorKey);

  if (monitoring) {
    clearInterval(monitoring.intervalId);
    monitoringIntervals.delete(monitorKey);
  }
}

function isBotBeingMonitored(guildId, botId) {
  const monitorKey = `${guildId}_${botId}`;
  return monitoringIntervals.has(monitorKey);
}

function isBotUnderEnhancedMonitoring(guildId, botId) {
  const enhancedKey = `${guildId}_${botId}`;
  return enhancedMonitoring.has(enhancedKey);
}

function getMonitoringStatistics(guildId) {
  const activeBots = [];
  const enhancedBots = [];

  for (const [, monitoring] of monitoringIntervals.entries()) {
    if (monitoring.data.guildId === guildId) {
      activeBots.push({
        botId: monitoring.data.botId,
        startTime: monitoring.data.startTime,
        creationsDetected: monitoring.data.creationsDetected,
        duration: Date.now() - monitoring.data.startTime,
      });
    }
  }

  for (const [, enhanced] of enhancedMonitoring.entries()) {
    if (enhanced.guildId === guildId) {
      enhancedBots.push({
        botId: enhanced.botId,
        startTime: enhanced.startTime,
        duration: Date.now() - enhanced.startTime,
      });
    }
  }

  return {
    guildId,
    activeMonitoring: activeBots.length,
    enhancedMonitoring: enhancedBots.length,
    activeBots,
    enhancedBots,
    timestamp: Date.now(),
  };
}

function stopAllMonitoringForGuild(guildId) {
  for (const [key, monitoring] of monitoringIntervals.entries()) {
    if (monitoring.data.guildId === guildId) {
      clearInterval(monitoring.intervalId);
      monitoringIntervals.delete(key);
    }
  }

  for (const [key, enhanced] of enhancedMonitoring.entries()) {
    if (enhanced.guildId === guildId) {
      enhancedMonitoring.delete(key);
    }
  }
}

function cleanupExpiredMonitoring() {
  const now = Date.now();
  const maxAge = 300000;

  for (const [key, monitoring] of monitoringIntervals.entries()) {
    if (now - monitoring.data.startTime > maxAge) {
      clearInterval(monitoring.intervalId);
      monitoringIntervals.delete(key);
    }
  }

  for (const [key, enhanced] of enhancedMonitoring.entries()) {
    if (now - enhanced.startTime > maxAge * 2) {
      enhancedMonitoring.delete(key);
    }
  }
}

setInterval(cleanupExpiredMonitoring, 120000);

export {
  activateEnhancedMonitoring,
  cleanupExpiredMonitoring,
  getMonitoringStatistics,
  isBotBeingMonitored,
  isBotUnderEnhancedMonitoring,
  monitorChannelCreations,
  performChannelCreationCheck,
  stopAllMonitoringForGuild,
  stopMonitoringChannelCreations,
};

