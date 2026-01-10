import { AuditLogEvent } from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../config/config.js';
import { encode } from './3y3.js';
import { cacheGet, cacheSet, safeExecute } from './coreUtils.js';
import { sendEntityLog } from './logUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const translations = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'translations.json'), 'utf8'),
);

async function logMessageDeleted(message, lang = 'fr') {
  return safeExecute(
    async () => {
      if (
        !message?.guild?.id ||
        !message?.author?.id ||
        !message?.channel?.id
      ) {
        return;
      }

      if (message.author.bot && message.author.flags?.has('VerifiedBot')) {
        return;
      }

      const cacheKey = `log_msg_del_${message.id}`;
      if (cacheGet(cacheKey)) return;
      cacheSet(cacheKey, true, 10000);

      const logChannel = message.guild.channels.cache.find(
        (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_message')),
      );

      if (!logChannel) return;

      lang = logChannel.topic?.includes(encode('en')) ? 'en' : lang;
      const translation = translations[lang];

      await sendEntityLog(
        message,
        'Deleted',
        'message',
        AuditLogEvent.MessageDelete,
        [
          {
            name: translation.content || 'Contenu',
            value: message.content || translation.noContent || 'Aucun contenu',
            inline: false,
          },
          {
            name: translation.channel || 'Salon',
            value: `<#${message.channel.id}>`,
            inline: true,
          },
          {
            name: translation.author || 'Auteur',
            value: `<@${message.author.id}>`,
            inline: true,
          },
        ],
        lang,
      );
    },
    {
      command: 'logDeletedMessage',
      messageId: message?.id,
      guildId: message?.guild?.id,
    },
  );
}

async function handleAntiGhostPing(message) {
  try {
    if (!message.content || !message.guild || message.author.bot) {
      return;
    }

    const ignoredGuildIds = ['1361374796365041814'];
    if (ignoredGuildIds.includes(message.guild.id)) {
      return;
    }

    const hasMentions =
      message.mentions.users.size > 0 ||
      message.mentions.repliedUser ||
      /<@!?\d{17,19}>/.test(message.content);

    if (!hasMentions) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const auditLogs = await message.guild
      .fetchAuditLogs({
        type: AuditLogEvent.MessageDelete,
        limit: 5,
      })
      .catch(() => null);

    let deletedByAuthor = true;

    if (auditLogs) {
      for (const auditEntry of auditLogs.entries.values()) {
        if (
          Date.now() - auditEntry.createdTimestamp < 10000 &&
          auditEntry.target?.id === message.author.id &&
          auditEntry.executor?.id !== message.author.id
        ) {
          deletedByAuthor = false;
          break;
        }
      }
    }

    if (deletedByAuthor) {
      const mentionedUserIds = new Set();
      if (message.mentions.users.size > 0) {
        message.mentions.users.forEach((user) => mentionedUserIds.add(user.id));
      }
      if (message.mentions.repliedUser) {
        mentionedUserIds.add(message.mentions.repliedUser.id);
      }
      const regexMentions = message.content.match(/<@!?(\d{17,19})>/g);
      if (regexMentions) {
        regexMentions.forEach((mention) => {
          const userId = mention.match(/\d{17,19}/)?.[0];
          if (userId) {
            mentionedUserIds.add(userId);
          }
        });
      }
      mentionedUserIds.delete(message.client?.user?.id);

      if (mentionedUserIds.size === 0) {
        return;
      }
      const mentionedUsers = Array.from(mentionedUserIds).map(
        (userId) => `<@${userId}>`,
      );

      const embed = {
        color: embedColor,
        title: '👻 Ghost Ping Détecté',
        description: `<@${message.author.id}> a supprimé un message avec des mentions.`,
        fields: [
          {
            name: '📝 Contenu supprimé',
            value:
              message.content.length > 1000 ?
                message.content.substring(0, 1000) + '...'
              : message.content,
            inline: false,
          },
          {
            name: '👥 Personnes mentionnées',
            value:
              mentionedUsers.slice(0, 10).join(', ') +
              (mentionedUsers.length > 10 ?
                ` et ${mentionedUsers.length - 10} autres`
              : ''),
            inline: false,
          },
        ],
        footer: {
          text: 'Système anti-ghost ping de GLaDOS',
        },
        timestamp: new Date(),
      };

      await message.channel
        .send({
          embeds: [embed],
        })
        .catch(() => {});
    }
  } catch (error) {
    if ([10008, 50013, 50001, 10003, 10004, 10006].includes(error.code)) {
      return;
    }
    triggerErrorEmbed(error, {
      command: 'handleAntiGhostPing',
      messageId: message?.id,
      guildId: message?.guild?.id,
    });
  }
}

async function logMessageUpdated(oldMessage, newMessage, lang = 'fr') {
  const logChannel = newMessage.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_message')),
  );
  lang = logChannel?.topic?.includes(encode('en')) ? 'en' : lang;

  const translation = translations[lang];

  const modifs =
    oldMessage.content !== newMessage.content ?
      `\`\`\`\n${oldMessage.content || translation.no} \n\`\`\`\n⬇\n\`\`\`\n${newMessage.content || translation.no} \n\`\`\``
    : translation.no;

  if (
    modifs === translation.no ||
    `\`\`\`\n${translation.no} \n\`\`\`\n⬇\n\`\`\`\n${translation.no} \n\`\`\``
  )
    return;

  await sendEntityLog(
    newMessage,
    'Updated',
    'message',
    null,
    [
      {
        name: translation.channel || 'Salon',
        value: `<#${newMessage.channel.id}>`,
      },
      {
        name: translation.content || 'Contenu',
        value: modifs,
      },
    ],
    lang,
  );
}

async function validateCountMessage(message) {
  const isCountChannel = ['count', 'compt', '𝗖𝗢𝗨𝗡𝗧'].some((word) =>
    message.channel.name?.toLowerCase().includes(word),
  );

  if (!isCountChannel) return true;

  const isValidMessage =
    !message.content.includes('\n') && /^[\d\s]+$/.test(message.content);
  if (!isValidMessage) {
    await message.delete().catch((error) =>
      triggerErrorEmbed(error, {
        command: 'validateCountMessage-delete1',
        messageId: message?.id,
      }),
    );
    return false;
  }

  const currentNumber = parseInt(message.content.replaceAll(' ', ''));
  const messages = await message.channel.messages.fetch({
    limit: 10,
  });
  const lastMessage = messages.filter((m) => m.id !== message.id).first();
  const expectedNumber =
    lastMessage ?
      isNaN(parseInt(lastMessage.content.replaceAll(' ', ''))) ? 1
      : parseInt(lastMessage.content.replaceAll(' ', '')) + 1
    : 1;
  if (currentNumber !== expectedNumber) {
    await message.delete().catch((error) =>
      triggerErrorEmbed(error, {
        command: 'validateCountMessage-delete2',
        messageId: message?.id,
      }),
    );
    return false;
  }

  return true;
}

function getMessageContent(message) {
  if (!message) return 'Message non disponible';
  if (!message.content) return 'Contenu non disponible';
  return message.content;
}

function getAuthorInfo(message) {
  if (!message || !message.author) {
    return {
      id: 'Inconnu',
      username: 'Utilisateur inconnu',
      displayName: 'Utilisateur inconnu',
    };
  }

  return {
    id: message.author.id || 'Inconnu',
    username: message.author.username || 'Utilisateur inconnu',
    displayName:
      message.author.displayName ||
      message.author.username ||
      'Utilisateur inconnu',
  };
}

export {
  getAuthorInfo,
  getMessageContent,
  handleAntiGhostPing,
  logMessageDeleted,
  logMessageUpdated,
  validateCountMessage,
};

