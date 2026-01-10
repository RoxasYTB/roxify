import { AuditLogEvent } from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encode } from './3y3.js';
import { fetchAuditLog, sendEntityLog } from './logUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const translations = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'translations.json'), 'utf8'),
);

async function logRoleCreated(role, lang = 'fr') {
  const logChannel = role.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_role')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;
  const log = await fetchAuditLog(role.guild, AuditLogEvent.GuildRoleCreate);
  const translation = translations[lang];
  const fields = [
    { name: translation.roleName, value: `<@&${role.id}>`, inline: true },
  ];
  if (log)
    fields.push({
      name: translation.createdBy,
      value: `<@${log.executor.id}>`,
      inline: true,
    });
  await sendEntityLog(
    role,
    'Created',
    'role',
    AuditLogEvent.GuildRoleCreate,
    fields,
    lang,
  );
}
async function logRoleDeleted(role, lang = 'fr') {
  const logChannel = role.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_role')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;
  const log = await fetchAuditLog(role.guild, AuditLogEvent.GuildRoleDelete);
  const translation = translations[lang];
  const fields = [
    { name: translation.roleDeletedName, value: role.name, inline: true },
  ];
  if (log)
    fields.push({
      name: translation.deletedBy,
      value: `<@${log.executor.id}>`,
      inline: true,
    });
  await sendEntityLog(
    role,
    'Deleted',
    'role',
    AuditLogEvent.GuildRoleDelete,
    fields,
    lang,
  );
}
function createRoleModificationsList(oldRole, newRole, lang = 'fr') {
  const logChannel = newRole.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_role')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;
  const translation = translations[lang];
  return [
    {
      condition: oldRole.name !== newRole.name,
      message: `${translation.name} : \`${oldRole.name}\` ➡️ \`${newRole.name}\``,
    },
    {
      condition: oldRole.color !== newRole.color,
      message: `${translation.color} : \`${oldRole.hexColor}\` ➡️ \`${newRole.hexColor}\``,
    },
    {
      condition: oldRole.hoist !== newRole.hoist,
      message: `${translation.hoist} : \`${oldRole.hoist ? translation.yes : translation.no}\` ➡️ \`${newRole.hoist ? translation.yes : translation.no}\``,
    },
    {
      condition: oldRole.mentionable !== newRole.mentionable,
      message: `${translation.mentionable} : \`${oldRole.mentionable ? translation.yes : translation.no}\` ➡️ \`${newRole.mentionable ? translation.yes : translation.no}\``,
    },
    {
      condition: !oldRole.permissions.equals(newRole.permissions),
      message: `${translation.permissions} : \`${oldRole.permissions.toArray().join(', ') || translation.no}\` ➡️ \`${newRole.permissions.toArray().join(', ') || translation.no}\``,
    },
  ]
    .filter((mod) => mod.condition)
    .map((mod) => mod.message);
}
async function logRoleUpdated(oldRole, newRole, lang = 'fr') {
  const logChannel = newRole.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_role')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;
  const modifications = createRoleModificationsList(oldRole, newRole, lang);
  if (modifications.length === 0) return;
  const translation = translations[lang];
  await sendEntityLog(
    newRole,
    'Updated',
    'role',
    AuditLogEvent.GuildRoleUpdate,
    [
      { name: translation.roleName, value: `<@&${newRole.id}>` },
      { name: translation.changes, value: modifications.join('\n') },
    ],
    lang,
  );
}
export {
  createRoleModificationsList,
  logRoleCreated,
  logRoleDeleted,
  logRoleUpdated,
};

