const performanceMetrics = {
  detection: {
    ultraFast: [],
    veryFast: [],
    fast: [],
    slow: [],
    totalCount: 0,
    averageTime: 0,
  },
  neutralization: {
    ultraFast: [],
    veryFast: [],
    fast: [],
    slow: [],
    totalCount: 0,
    averageTime: 0,
  },
  raids: {
    total: 0,
    neutralized: 0,
    failed: 0,
    successRate: 100,
  },
  server: {
    uptime: Date.now(),
    lastRaidTime: null,
    raidsPrevented: 0,
  },
};

const recentEvents = [];
const MAX_EVENTS_CACHE = 1000;

function recordDetectionMetric(detectionTime, guildId, botId) {
  const metric = {
    time: detectionTime,
    timestamp: Date.now(),
    guildId,
    botId,
    type: 'detection',
  };

  if (detectionTime < 5) {
    performanceMetrics.detection.ultraFast.push(metric);
  } else if (detectionTime < 25) {
    performanceMetrics.detection.veryFast.push(metric);
  } else if (detectionTime < 50) {
    performanceMetrics.detection.fast.push(metric);
  } else {
    performanceMetrics.detection.slow.push(metric);
  }

  performanceMetrics.detection.totalCount++;
  updateAverageDetectionTime();
  addToRecentEvents(metric);
}

function recordNeutralizationMetric(
  neutralizationTime,
  guildId,
  botId,
  channelsDeleted,
  success = true,
) {
  const metric = {
    time: neutralizationTime,
    timestamp: Date.now(),
    guildId,
    botId,
    channelsDeleted,
    success,
    type: 'neutralization',
  };

  if (neutralizationTime < 100) {
    performanceMetrics.neutralization.ultraFast.push(metric);
  } else if (neutralizationTime < 300) {
    performanceMetrics.neutralization.veryFast.push(metric);
  } else if (neutralizationTime < 500) {
    performanceMetrics.neutralization.fast.push(metric);
  } else {
    performanceMetrics.neutralization.slow.push(metric);
  }

  performanceMetrics.neutralization.totalCount++;
  updateAverageNeutralizationTime();

  performanceMetrics.raids.total++;
  if (success) {
    performanceMetrics.raids.neutralized++;
    performanceMetrics.server.raidsPrevented++;
  } else {
    performanceMetrics.raids.failed++;
  }

  performanceMetrics.raids.successRate =
    (performanceMetrics.raids.neutralized / performanceMetrics.raids.total) *
    100;

  performanceMetrics.server.lastRaidTime = Date.now();
  addToRecentEvents(metric);
}

function updateAverageDetectionTime() {
  const allTimes = [
    ...performanceMetrics.detection.ultraFast,
    ...performanceMetrics.detection.veryFast,
    ...performanceMetrics.detection.fast,
    ...performanceMetrics.detection.slow,
  ];

  if (allTimes.length > 0) {
    const sum = allTimes.reduce((acc, metric) => acc + metric.time, 0);
    performanceMetrics.detection.averageTime = sum / allTimes.length;
  }
}

function updateAverageNeutralizationTime() {
  const allTimes = [
    ...performanceMetrics.neutralization.ultraFast,
    ...performanceMetrics.neutralization.veryFast,
    ...performanceMetrics.neutralization.fast,
    ...performanceMetrics.neutralization.slow,
  ];

  if (allTimes.length > 0) {
    const sum = allTimes.reduce((acc, metric) => acc + metric.time, 0);
    performanceMetrics.neutralization.averageTime = sum / allTimes.length;
  }
}

function addToRecentEvents(event) {
  recentEvents.push(event);

  if (recentEvents.length > MAX_EVENTS_CACHE) {
    recentEvents.splice(0, recentEvents.length - MAX_EVENTS_CACHE);
  }

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let i = 0;
  while (i < recentEvents.length && recentEvents[i].timestamp < oneDayAgo) {
    i++;
  }
  if (i > 0) {
    recentEvents.splice(0, i);
  }
}

function getRecentEvents(limit = 50) {
  return recentEvents.slice(-limit).sort((a, b) => b.timestamp - a.timestamp);
}

function cleanupOldMetrics() {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  performanceMetrics.detection.ultraFast =
    performanceMetrics.detection.ultraFast.filter(
      (m) => m.timestamp > oneDayAgo,
    );
  performanceMetrics.detection.veryFast =
    performanceMetrics.detection.veryFast.filter(
      (m) => m.timestamp > oneDayAgo,
    );
  performanceMetrics.detection.fast = performanceMetrics.detection.fast.filter(
    (m) => m.timestamp > oneDayAgo,
  );
  performanceMetrics.detection.slow = performanceMetrics.detection.slow.filter(
    (m) => m.timestamp > oneDayAgo,
  );

  performanceMetrics.neutralization.ultraFast =
    performanceMetrics.neutralization.ultraFast.filter(
      (m) => m.timestamp > oneDayAgo,
    );
  performanceMetrics.neutralization.veryFast =
    performanceMetrics.neutralization.veryFast.filter(
      (m) => m.timestamp > oneDayAgo,
    );
  performanceMetrics.neutralization.fast =
    performanceMetrics.neutralization.fast.filter(
      (m) => m.timestamp > oneDayAgo,
    );
  performanceMetrics.neutralization.slow =
    performanceMetrics.neutralization.slow.filter(
      (m) => m.timestamp > oneDayAgo,
    );

  updateAverageDetectionTime();
  updateAverageNeutralizationTime();
}

export {
  cleanupOldMetrics,
  getRecentEvents,
  performanceMetrics,
  recordDetectionMetric,
  recordNeutralizationMetric,
};

