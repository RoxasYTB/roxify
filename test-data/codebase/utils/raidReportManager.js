import { createRaidReport } from './createRaidReport.js';
import { sendToReportWebhook } from './specialCommandHandler.js';

const reportLocks = new Map();
const sentReportsCache = new Map();

const REPORT_LOCK_DURATION = 5000;
const CACHE_DURATION = 30000;

async function sendUniqueRaidReport(
  guild,
  title,
  options = {},
  reportType,
  botId = null,
) {
  const reportKey = generateReportKey(guild.id, reportType, botId, title);

  if (reportLocks.has(reportKey)) {
    return false;
  }

  if (sentReportsCache.has(reportKey)) {
    const cacheData = sentReportsCache.get(reportKey);
    if (Date.now() - cacheData.timestamp < CACHE_DURATION) {
      return false;
    }
  }

  reportLocks.set(reportKey, {
    timestamp: Date.now(),
    guild: guild.id,
    reportType,
    botId,
  });

  setTimeout(() => {
    reportLocks.delete(reportKey);
  }, REPORT_LOCK_DURATION);

  try {
    const embed = await createRaidReport(guild, title, options);

    const success = await sendToReportWebhook(embed);

    if (success) {
      sentReportsCache.set(reportKey, {
        timestamp: Date.now(),
        reportType,
        botId,
        title,
      });

      setTimeout(() => {
        sentReportsCache.delete(reportKey);
      }, CACHE_DURATION);

      return true;
    }

    return false;
  } catch (error) {
    reportLocks.delete(reportKey);
    throw error;
  }
}

function generateReportKey(guildId, reportType, botId, title) {
  const baseKey = `${guildId}_${reportType}`;

  const keyWithBot = botId ? `${baseKey}_${botId}` : baseKey;

  const titleHash =
    title ? title.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '') : '';

  return `${keyWithBot}_${titleHash}`;
}

function isReportInProgress(guildId, reportType, botId = null) {
  const reportKey = generateReportKey(guildId, reportType, botId, '');
  return reportLocks.has(reportKey);
}

function hasReportBeenSentRecently(
  guildId,
  reportType,
  botId = null,
  title = '',
) {
  const reportKey = generateReportKey(guildId, reportType, botId, title);

  if (sentReportsCache.has(reportKey)) {
    const cacheData = sentReportsCache.get(reportKey);
    return Date.now() - cacheData.timestamp < CACHE_DURATION;
  }

  return false;
}

function clearReportCache(guildId = null) {
  if (guildId) {
    for (const [key] of sentReportsCache.entries()) {
      if (key.startsWith(guildId)) {
        sentReportsCache.delete(key);
      }
    }

    for (const [key, data] of reportLocks.entries()) {
      if (data.guild === guildId) {
        reportLocks.delete(key);
      }
    }
  } else {
    sentReportsCache.clear();
    reportLocks.clear();
  }
}

setInterval(() => {
  const now = Date.now();

  for (const [key, data] of reportLocks.entries()) {
    if (now - data.timestamp > REPORT_LOCK_DURATION) {
      reportLocks.delete(key);
    }
  }

  for (const [key, data] of sentReportsCache.entries()) {
    if (now - data.timestamp > CACHE_DURATION) {
      sentReportsCache.delete(key);
    }
  }
}, 10000);

export {
  clearReportCache,
  hasReportBeenSentRecently,
  isReportInProgress,
  sendUniqueRaidReport,
};

