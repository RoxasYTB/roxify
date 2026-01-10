const MEMORY_CACHE = new Map();
const CACHE_CLEANUP_INTERVAL = 15000;
const MAX_CACHE_SIZE = 5000;
const LRU_CLEANUP_THRESHOLD = 0.8;

let cacheAccessTimes = new Map();
let cacheFrequency = new Map();

const cleanupCache = () => {
  if (MEMORY_CACHE.size > MAX_CACHE_SIZE * LRU_CLEANUP_THRESHOLD) {
    const now = Date.now();
    const entries = Array.from(cacheAccessTimes.entries());

    const scoredEntries = entries.map(([key, lastAccess]) => {
      const frequency = cacheFrequency.get(key) || 1;
      const age = now - lastAccess;
      return {
        key,
        score: age / frequency,
      };
    });

    const toRemove = scoredEntries
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.floor(MEMORY_CACHE.size * 0.3));

    toRemove.forEach(({ key }) => {
      MEMORY_CACHE.delete(key);
      cacheAccessTimes.delete(key);
      cacheFrequency.delete(key);
    });
  }
};

setInterval(cleanupCache, CACHE_CLEANUP_INTERVAL);

const cacheGet = (key) => {
  const item = MEMORY_CACHE.get(key);
  if (item && Date.now() - item.timestamp < item.ttl) {
    const now = Date.now();
    cacheAccessTimes.set(key, now);

    cacheFrequency.set(key, (cacheFrequency.get(key) || 0) + 1);
    return item.data;
  }

  if (item) {
    MEMORY_CACHE.delete(key);
    cacheAccessTimes.delete(key);
    cacheFrequency.delete(key);
  }
  return null;
};

const cacheSet = (key, data, ttl = 120000) => {
  const now = Date.now();
  MEMORY_CACHE.set(key, {
    data,
    timestamp: now,
    ttl,
  });
  cacheAccessTimes.set(key, now);
  cacheFrequency.set(key, 1);

  if (MEMORY_CACHE.size > MAX_CACHE_SIZE * 0.9) {
    setImmediate(cleanupCache);
  }
};

const debounce = (func, wait) => {
  let timeout;
  let lastArgs;
  return function executedFunction(...args) {
    lastArgs = args;
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func.apply(this, lastArgs), wait);
  };
};

const throttle = (func, limit) => {
  let inThrottle;
  let lastCall;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      lastCall = Date.now();
      inThrottle = true;

      const remaining = limit - (Date.now() - lastCall);
      if (remaining > 0) {
        setTimeout(() => (inThrottle = false), remaining);
      } else {
        setImmediate(() => (inThrottle = false));
      }
    }
  };
};

const REGEX_CACHE = new Map([
  ['snowflake', /^\d{17,19}$/],
  ['url', /^https?:\/\/.+/],
  ['numberFormat', /\B(?=(\d{3})+(?!\d))/g],
  ['mention', /<@!?(\d+)>/g],
  ['channel', /<#(\d+)>/g],
  ['role', /<@&(\d+)>/g],
  ['emoji', /<a?:\w+:\d+>/g],
]);

const isValid = {
  string: (v) => typeof v === 'string' && v.length > 0,
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  snowflake: (id) =>
    typeof id === 'string' &&
    id.length >= 17 &&
    id.length <= 19 &&
    REGEX_CACHE.get('snowflake').test(id),
  url: (url) =>
    typeof url === 'string' &&
    url.length > 7 &&
    REGEX_CACHE.get('url').test(url),
  array: (arr) => Array.isArray(arr) && arr.length > 0,
  function: (fn) => typeof fn === 'function',
};

const sanitize = (str, max = 1000) =>
  typeof str === 'string' ? str.trim().slice(0, max) : '';

const checkPermissions = (member, permissions) => {
  if (!member?.permissions) return false;
  return Array.isArray(permissions) ?
      permissions.every((perm) => member.permissions.has(perm))
    : member.permissions.has(permissions);
};

const hasGuildPermission = (guild, permission) => {
  return guild?.members?.me?.permissions?.has(permission) ?? false;
};

const safeStringify = (obj, maxDepth = 3, currentDepth = 0) => {
  if (currentDepth > maxDepth) return '[Max Depth Reached]';

  try {
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString() + 'n';
      }
      if (typeof value === 'function') {
        return '[Function]';
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      if (
        typeof value === 'object' &&
        value !== null &&
        currentDepth < maxDepth
      ) {
        return value;
      }
      if (typeof value === 'object' && currentDepth >= maxDepth) {
        return '[Object]';
      }
      return value;
    });
  } catch (error) {
    return '[Serialization Error: ' + error.message + ']';
  }
};

const errorPool = new Map();
const MAX_ERROR_POOL_SIZE = 100;

const safeExecute = async (operation) => {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    const errorKey = `${error.name}_${error.message?.slice(0, 50)}`;

    if (!errorPool.has(errorKey)) {
      if (errorPool.size >= MAX_ERROR_POOL_SIZE) {
        const firstKey = errorPool.keys().next().value;
        errorPool.delete(firstKey);
      }
      errorPool.set(errorKey, {
        count: 1,
        lastSeen: Date.now(),
        error: error,
      });
    } else {
      const pooled = errorPool.get(errorKey);
      pooled.count++;
      pooled.lastSeen = Date.now();
    }

    return null;
  }
};

const safeReply = async (interaction, content, options = {}) => {
  return safeExecute(async () => {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp({
        ...content,
        ...options,
      });
    }
    return await interaction.reply({
      ...content,
      ...options,
    });
  });
};

const safeDelete = async (message) => {
  return safeExecute(async () => {
    if (message?.deletable) return await message.delete();
  });
};

const formatDuration = (duration) => {
  if (!isValid.number(duration)) return 'Indéterminée';
  const units = [
    {
      name: 'j',
      value: 86400,
    },
    {
      name: 'h',
      value: 3600,
    },
    {
      name: 'm',
      value: 60,
    },
    {
      name: 's',
      value: 1,
    },
  ];
  const result = [];
  for (const unit of units) {
    const count = Math.floor(duration / unit.value);
    if (count > 0) {
      result.push(`${count}${unit.name}`);
      duration %= unit.value;
    }
  }
  return result.length ? result.join(' ') : '0s';
};

const formatNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const sansAccents = (str) =>
  str
    .replace(/[àáâäæã]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôöœø]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ñ]/g, 'n');

const getRandomItem = (a) => a[Math.floor(Math.random() * a.length)];
const formatResponse = (r, p = {}) =>
  Object.entries(p).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), v),
    r,
  );
const getRandomResponse = (r, p = {}) => formatResponse(getRandomItem(r), p);

const optimizeEmbed = (embed) => {
  if (embed.description && embed.description.length > 4096) {
    embed.description = embed.description.substring(0, 4093) + '...';
  }
  if (embed.fields) {
    embed.fields = embed.fields.slice(0, 25).map((field) => ({
      ...field,
      name: field.name.substring(0, 256),
      value: field.value.substring(0, 1024),
    }));
  }
  return embed;
};

export {
  cacheGet,
  cacheSet,
  checkPermissions,
  debounce,
  formatDuration,
  formatNumber,
  formatResponse,
  getRandomItem,
  getRandomResponse,
  hasGuildPermission,
  isValid,
  optimizeEmbed,
  safeDelete,
  safeExecute,
  safeReply,
  safeStringify,
  sanitize,
  sansAccents,
  throttle,
};

