import { encode } from './3y3.js';
import { cacheGet, cacheSet } from './coreUtils.js';
import globalLogFunction from './globalLogFunction.js';
import { hasAuditLogPermission } from './permissionsUtils.js';

function findLogChannel(guild, logType) {
  return guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode(`log_${logType}`)),
  );
}

async function fetchAuditLog(guild, auditLogType) {
  if (!hasAuditLogPermission(guild)) return null;

  const cacheKey = `audit_${guild.id}_${auditLogType}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const logs = await guild.fetchAuditLogs({
      limit: 1,
      type: auditLogType,
    });
    const result = logs.entries.first() || null;
    cacheSet(cacheKey, result, 10000);
    return result;
  } catch (error) {
    if (error.code === 50013) return null;
    return null;
  }
}

async function sendEntityLog(
  entity,
  action,
  entityType,
  auditLogType,
  additionalFields = [],
  lang = 'fr',
) {
  if (!hasAuditLogPermission(entity.guild)) return;
  const logChannel = findLogChannel(entity.guild, entityType);
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;
  if (!logChannel) return;
  await globalLogFunction(
    entity,
    action,
    entityType,
    auditLogType,
    additionalFields,
    lang,
  );
}

function createStandardLogFields() {
  return [];
}

function canAccessAuditLogs() {
  return false;
}

function canBanMembers() {
  return false;
}

function canKickMembers() {
  return false;
}

function canManageChannels() {
  return false;
}

function canManageRoles() {
  return false;
}

function handlePermissionError() {
  return null;
}

export {
  canAccessAuditLogs,
  canBanMembers,
  canKickMembers,
  canManageChannels,
  canManageRoles,
  createStandardLogFields,
  fetchAuditLog,
  findLogChannel,
  handlePermissionError,
  hasAuditLogPermission,
  sendEntityLog,
};

