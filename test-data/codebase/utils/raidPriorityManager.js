const guildRaidProcessingMap = new Map();
const RAID_PROCESSING_TIMEOUT = 15000;

function isGuildProcessingChannelRaid(guildId) {
  return guildRaidProcessingMap.has(guildId);
}

function markGuildAsProcessingChannelRaid(guildId, botId = null) {
  const timestamp = Date.now();
  guildRaidProcessingMap.set(guildId, {
    startTime: timestamp,
    botId,
  });

  setTimeout(() => {
    guildRaidProcessingMap.delete(guildId);
  }, RAID_PROCESSING_TIMEOUT);
}

function unmarkGuildChannelRaidProcessing(guildId) {
  guildRaidProcessingMap.delete(guildId);
}

function getChannelRaidProcessingTime(guildId) {
  const data = guildRaidProcessingMap.get(guildId);
  if (!data) return 0;
  return Date.now() - data.startTime;
}

export {
  getChannelRaidProcessingTime,
  isGuildProcessingChannelRaid,
  markGuildAsProcessingChannelRaid,
  unmarkGuildChannelRaidProcessing,
};

