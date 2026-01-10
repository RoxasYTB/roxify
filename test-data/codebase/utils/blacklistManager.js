import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { blacklistApiUrl } from '../config/config.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let blacklistSet = new Set();
let blacklistArray = [];

const httpOptions = {
  timeout: 1500,
  headers: {
    authorization: process.env.BLACKLIST_AVENTUROS,
    'user-agent': 'GladosBot/1.0',
    accept: 'application/json',
  },
};

async function updateBlacklist(client) {
  try {
    const blacklistFilePath = path.join(__dirname, '..', 'blacklist.json');

    const [localResult, onlineResult] = await Promise.allSettled([
      readLocalBlacklistOptimized(blacklistFilePath),
      fetchOnlineBlacklistOptimized(),
    ]);

    const jsonBlacklist =
      localResult.status === 'fulfilled' ? localResult.value : [];
    const remoteBlacklist =
      onlineResult.status === 'fulfilled' ? onlineResult.value : [];

    const mergedSet = new Set([...jsonBlacklist, ...remoteBlacklist]);
    blacklistArray = Array.from(mergedSet);
    blacklistSet = mergedSet;

    if (client) {
      setImmediate(() => {
        client.blacklist = blacklistArray;
      });
    }

    return blacklistArray;
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'updateBlacklist',
      step: 'critical_error',
      component: 'blacklistManager',
    });

    return blacklistArray || [];
  }
}

let localFileStats = null;
let localFileContent = null;

async function readLocalBlacklistOptimized(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);

    if (
      localFileStats &&
      stats.mtimeMs === localFileStats.mtimeMs &&
      localFileContent
    ) {
      return localFileContent;
    }

    const data = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    const processed =
      Array.isArray(parsed) ?
        parsed.map((id) => (Array.isArray(id) ? id[0] : id))
      : [];

    localFileStats = stats;
    localFileContent = processed;

    return processed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      setImmediate(async () => {
        await fs.promises.writeFile(filePath, JSON.stringify([], null, 2));
      });
    }
    return [];
  }
}

let consecutiveFailures = 0;
let lastFailureTime = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_TIMEOUT = 30000;

async function fetchOnlineBlacklistOptimized() {
  const now = Date.now();

  if (
    consecutiveFailures >= MAX_CONSECUTIVE_FAILURES &&
    now - lastFailureTime < CIRCUIT_BREAKER_TIMEOUT
  ) {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), httpOptions.timeout);

    const response = await fetch(blacklistApiUrl, {
      method: 'GET',
      headers: httpOptions.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.text();
      const processed = data
        .replace(/[[\]""]/g, '')
        .split(',')
        .filter((id) => id.trim());

      consecutiveFailures = 0;
      lastFailureTime = 0;

      return processed;
    }

    throw new Error(`HTTP ${response.status}`);
  } catch {
    consecutiveFailures++;
    lastFailureTime = now;

    return [];
  }
}

function getBlacklistCache() {
  return blacklistArray || [];
}

function isUserBlacklisted(userId) {
  return blacklistSet.has(userId);
}

export { getBlacklistCache, isUserBlacklisted, updateBlacklist };

