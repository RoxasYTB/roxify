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

async function logChannelCreated(channel, lang = 'fr') {
  const logChannel = channel.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_channel')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;

  const log = await fetchAuditLog(channel.guild, AuditLogEvent.ChannelCreate);
  const translation = translations[lang];

  const additionalFields = [
    {
      name: translation.channelName || 'Channel Name',
      value: `<#${channel.id}>`,
      inline: true,
    },
    log ?
      {
        name: translation.createdBy || 'Created By',
        value: `<@${log.executor.id}>`,
        inline: true,
      }
    : null,
  ].filter(Boolean);

  await sendEntityLog(
    channel,
    'Created',
    'channel',
    AuditLogEvent.ChannelCreate,
    additionalFields,
    lang,
  );
}

async function logChannelDeleted(channel, lang = 'fr') {
  const logChannel = channel.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_channel')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;

  const log = await fetchAuditLog(channel.guild, AuditLogEvent.ChannelDelete);
  const translation = translations[lang];

  const additionalFields = [
    {
      name: translation.channelName,
      value: `#${channel.name}`,
      inline: true,
    },
  ];

  if (log) {
    additionalFields.push({
      name: translation.deletedBy,
      value: `<@${log.executor.id}>`,
      inline: true,
    });

    if (log.reason) {
      additionalFields.push({
        name: translation.reason || 'Raison',
        value: log.reason,
        inline: false,
      });
    }
  } else {
    additionalFields.push({
      name: translation.deletedBy,
      value: translation.unknownUser,
      inline: true,
    });
  }

  await sendEntityLog(
    channel,
    'Deleted',
    'channel',
    AuditLogEvent.ChannelDelete,
    additionalFields,
    lang,
  );
}

function createChannelModificationsList(oldChannel, newChannel, lang = 'fr') {
  const logChannel = newChannel.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_channel')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;

  const translation = translations[lang];
  const modifications = [];

  const addModification = (oldValue, newValue, key) => {
    if (oldValue !== newValue) {
      const propertyName = translation[key] || key;
      const noneValue = translation.no || 'None';
      modifications.push(
        `${propertyName} : \`${oldValue || noneValue} \` ➡ \`${newValue || noneValue} \``,
      );
    }
  };

  addModification(oldChannel.name, newChannel.name, 'name');
  addModification(oldChannel.position, newChannel.position, 'position');
  addModification(oldChannel.topic, newChannel.topic, 'topic');
  addModification(oldChannel.nsfw, newChannel.nsfw, 'nsfw');
  addModification(oldChannel.parent?.name, newChannel.parent?.name, 'parent');

  return modifications;
}

async function logChannelUpdated(oldChannel, newChannel, lang = 'fr') {
  const logChannel = newChannel.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_channel')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;

  const log = await fetchAuditLog(
    newChannel.guild,
    AuditLogEvent.ChannelUpdate,
  );
  const translation = translations[lang];
  const modifications = createChannelModificationsList(
    oldChannel,
    newChannel,
    lang,
  );

  if (modifications.length === 0) return;

  const fields = [
    {
      name: translation.channelName || 'Channel Name',
      value: `<#${newChannel.id}>`,
      inline: true,
    },
    {
      name: translation.changes || 'Changes',
      value: modifications.join('\n'),
      inline: false,
    },
    ...(log ?
      [
        {
          name: translation.updatedBy || 'Updated By',
          value: `<@${log.executor.id}>`,
          inline: true,
        },
      ]
    : []),
  ];

  await sendEntityLog(
    newChannel,
    'Updated',
    'channel',
    AuditLogEvent.ChannelUpdate,
    fields,
    lang,
  );
}

export {
  createChannelModificationsList,
  logChannelCreated,
  logChannelDeleted,
  logChannelUpdated,
};

