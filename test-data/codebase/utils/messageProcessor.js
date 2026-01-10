import { messageSeparator as _messageSeparator } from '../config/config.js';
import { cacheGet, cacheSet } from './coreUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const sansAccents = (str) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

async function processMessageContext(message, client, WhiteListBotName) {
  if (!message || !client || !message.channel) {
    return {
      context: '',
      refContext: '',
      isRefUsableForCommand: false,
      imageContent: '',
    };
  }

  const cacheKey = `msg_context_${message.channel.id}_${message.id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const desiredTextMessages = 5;
    const maxFetch = 50;
    const fetched = await message.channel.messages.fetch({
      limit: maxFetch,
      before: message.id,
    });
    const allMessages = [...fetched.values()].reverse();

    const hasRealText = (msg) => {
      const content = (msg.content || '').trim();
      if (content) return true;
      if (msg.attachments && msg.attachments.size > 0) return true;
      if (msg.embeds && msg.embeds.length > 0) return true;
      if (msg.system) return true;
      return false;
    };

    const textMessages = allMessages
      .filter(hasRealText)
      .slice(-desiredTextMessages);

    const formatMessageForContext = (msg) => {
      let text = (msg.content || '').trim();
      if (!text) {
        if (msg.attachments && [...msg.attachments.values()].length > 0) {
          const attList = [...msg.attachments.values()]
            .map((a) => a.name || a.url)
            .join(', ');
          text = `[attachment: ${attList}]`;
        } else if (msg.embeds && msg.embeds.length > 0) {
          const embedText = msg.embeds
            .map((e) => e.title || e.description || '')
            .filter(Boolean)
            .join(' - ');
          text = embedText ? `[embed: ${embedText}]` : '[embed]';
        } else if (msg.system) {
          text = `[system message: ${msg.type || 'unknown'}]`;
        } else {
          text = '[message sans contenu]';
        }
      }
      return {
        role: msg.author.id === client.user.id ? 'assistant' : 'user',
        authorName: msg.author.displayName.replace(
          client.user.username,
          WhiteListBotName,
        ),
        authorId: msg.author.id,
        content: text,
      };
    };
    let contextMessages = textMessages.map((msg) =>
      formatMessageForContext(msg),
    );

    const assistantMsg = allMessages
      .slice()
      .reverse()
      .find((m) => m.author?.id === client.user.id && hasRealText(m));
    if (assistantMsg) {
      const assistantFormatted = formatMessageForContext(assistantMsg);
      if (!contextMessages.some((c) => c.authorId === assistantMsg.author.id)) {
        contextMessages.push(assistantFormatted);
        if (contextMessages.length > desiredTextMessages)
          contextMessages = contextMessages.slice(-desiredTextMessages);
      }
    }

    if (hasRealText(message)) {
      contextMessages.push(formatMessageForContext(message));
    }

    const reference = message.reference;

    if (reference) {
      try {
        const referencedMessage2 = await message.channel.messages.fetch(
          reference.messageId,
        );
        if (referencedMessage2 && hasRealText(referencedMessage2)) {
          const refFormatted2 = formatMessageForContext(referencedMessage2);
          if (
            !contextMessages.some(
              (c) => c.authorId === referencedMessage2.author.id,
            )
          ) {
            contextMessages.push(refFormatted2);
            if (contextMessages.length > desiredTextMessages)
              contextMessages = contextMessages.slice(-desiredTextMessages);
          }
        }
      } catch {}
    }
    let refContext = null,
      isRefUsableForCommand = true;
    if (reference) {
      let referencedMessage;
      try {
        referencedMessage = await message.channel.messages.fetch(
          reference.messageId,
        );
      } catch {
        referencedMessage = null;
      }
      if (referencedMessage) {
        refContext = formatMessageForContext(referencedMessage);
        isRefUsableForCommand = referencedMessage.author?.id === client.user.id;
      }
    }
    let imageContent = [...(message.attachments?.values() || [])]
      .filter((att) => att.contentType?.startsWith('image/'))
      .map((att) => att.url);
    if (reference && !imageContent.length) {
      const referencedMessage = await message.channel.messages.fetch(
        reference.messageId,
      );
      if (referencedMessage) {
        imageContent = [...(referencedMessage.attachments?.values() || [])]
          .filter((att) => att.contentType?.startsWith('image/'))
          .map((att) => att.url);
      }
    }

    imageContent = imageContent
      .filter((url) => {
        try {
          new URL(url);
          return url.length < 2000 && url.includes('discord');
        } catch {
          return false;
        }
      })
      .slice(0, 5);

    const result = {
      contextMessages,
      refContext,
      isRefUsableForCommand,
      imageContent,
    };

    cacheSet(cacheKey, result, 30000);
    return result;
  } catch (error) {
    triggerErrorEmbed(
      error,
      client?.user?.username,
      client?.user?.displayAvatarURL(),
    );
    console.error('Error processing message context:', error);
    const fallbackText =
      (message?.content && message.content.trim()) ||
      (message?.attachments && [...message.attachments.values()].length ?
        `Attachment: ${[...message.attachments.values()].map((a) => a.name || a.url).join(', ')}`
      : '[message sans contenu]');
    return {
      contextMessages: [
        {
          role: 'user',
          authorName: message?.author?.displayName || 'Utilisateur inconnu',
          authorId: message?.author?.id || 'N/A',
          content: fallbackText,
        },
      ],
      refContext: null,
      isRefUsableForCommand: false,
      imageContent: [],
    };
  }
}

function processResponseText(responseText, authorUsername, WhiteListBotName) {
  if (!responseText || typeof responseText !== 'string') {
    return '';
  }

  try {
    return responseText
      .replaceAll('ysannier_', 'Roxas')
      .replace(
        new RegExp(`(${authorUsername} |${WhiteListBotName}) : `, 'g'),
        '',
      )
      .replace(/, {2}/g, ', ')
      .replaceAll('omment origi', "comme c'est origi")
      .replaceAll('(1098179232779223080) ', '')
      .replace(/^\(\d{17,19}\) /, '');
  } catch (error) {
    triggerErrorEmbed(error, null, null);
    return responseText;
  }
}

const detectCommands = (responseText, commandPermissions) => {
  if (!responseText || !commandPermissions) {
    return [];
  }

  try {
    return Object.keys(commandPermissions).filter((cmd) =>
      responseText.toLowerCase().includes(cmd),
    );
  } catch (error) {
    triggerErrorEmbed(error, null, null);
    return [];
  }
};

function checkVisibleLinkContainsHttp(content) {
  const visibleTextPattern = /\[[^\]]*\]\((http[^\s)]+)\)/gi;
  const cleanedContent = content.replace(/[^a-zA-Z0-9:/.\s[\]()]/g, '');
  return [...cleanedContent.matchAll(visibleTextPattern)].length > 0;
}

export default {
  sansAccents,
  processMessageContext,
  processResponseText,
  detectCommands,
  checkVisibleLinkContainsHttp,
  messageSeparator: _messageSeparator,
};

