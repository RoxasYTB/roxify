import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../config/config.js';
import { encode } from './3y3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function globalLogFunction(
  object,
  action,
  type,
  event,
  additionalFields = [],
  lang = 'fr',
) {
  const logChannel = object.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode(type)),
  );

  if (!logChannel || !logChannel.isTextBased()) return;

  lang = logChannel.topic?.includes(encode('en')) ? 'en' : lang;

  const translations = JSON.parse(
    readFileSync(path.join(__dirname, '../translations.json'), 'utf8'),
  );
  const translation = translations[lang] || translations['fr'];

  const logEmbed = {
    color: embedColor,
    title: translation[`${type}${action}Title`],
    description: translation[`${type}${action}Description`],
    fields: additionalFields,
    timestamp: new Date(),
    footer: {
      text: translation.channelLogs || translation.footer || 'Logs',
    },
  };

  const splitEmbedFields = (embed) => {
    const maxFieldLength = 1024;
    const embedsToSend = [];
    let currentEmbed = {
      ...embed,
      fields: [],
    };

    embed.fields
      .map((field) => `${field.name} \n${field.value}`)
      .forEach((field) => {
        if (
          currentEmbed.fields.join('\n').length + field.length >
          maxFieldLength
        ) {
          embedsToSend.push(currentEmbed);
          currentEmbed = {
            ...embed,
            fields: [],
          };
        }
        currentEmbed.fields.push({
          name: '\u200b',
          value: field,
        });
      });

    if (currentEmbed.fields.length) embedsToSend.push(currentEmbed);
    return embedsToSend;
  };

  try {
    for (const embed of splitEmbedFields(logEmbed)) {
      await logChannel.send({
        embeds: [embed],
      });
    }
  } catch {
    return;
  }
}

export default globalLogFunction;

