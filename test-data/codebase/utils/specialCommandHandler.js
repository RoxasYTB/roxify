import { EmbedBuilder } from 'discord.js';
import { embedColor } from '../config/config.js';
import configConstants from '../data/configConstants.json' with { type: 'json' };
import { safeReply } from './coreUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const { webhooks } = configConstants;
const REPORT_WEBHOOK_URL = webhooks.report;

const sendToReportWebhook = async (embed, client = null) => {
  try {
    if (!client) {
      try {
        const { default: botClient } = await import('../bot.js');
        client = botClient;
      } catch {
        throw new Error(
          "Client Discord non disponible pour l'envoi du rapport",
        );
      }
    }

    const username = client?.user?.username || 'GLaDOS';
    let avatarURL =
      'https://cdn.discordapp.com/avatars/1098179232779223080/a_796afb854b65d2ee4b16625054571ee2.gif';

    let response;
    try {
      response = await fetch(REPORT_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username,
          avatarURL,
          embeds: [embed],
        }),
      });
    } catch (err) {
      if (err.code === 10015 || err.message?.includes('Unknown Webhook')) {
        return false;
      }
      throw err;
    }

    if (!response.ok) {
      if (response.status === 404) {
        return false;
      }
      throw new Error(
        `Webhook responded with status ${response.status}: ${response.statusText}`,
      );
    }

    return true;
  } catch (e) {
    triggerErrorEmbed(e, {
      userId: 'SYSTEM',
      source: 'specialCommandHandler.js',
      action: 'sendToReportWebhook',
    });
    return false;
  }
};

const handleHypeProtectCommand = async (message) => {
  try {
    const response = await fetch(
      'https://discord.com/api/v10/users/1123260264557584565',
      {
        headers: {
          Authorization: `Bot ${message.client.token}`,
        },
      },
    );
    if (!response.ok) throw new Error(`Discord API error: ${response.status} `);
    const mutualGuilds = message.client.guilds.cache.filter((g) =>
      g.members.cache.has('1123260264557584565'),
    );
    try {
      const messageExists = await message.channel.messages
        .fetch(message.id)
        .catch(() => null);
      if (messageExists) {
        message.reply({
          content:
            mutualGuilds.size ?
              `Serveurs où <@1123260264557584565 > est présent en commun avec moi: \n${mutualGuilds.map((g) => `\`${g.id} \` - ${g.name}`).join('\n')} `
            : "<@1123260264557584565> n'est présent sur aucun serveur en commun avec moi.",
          allowedMentions: {
            parse: [],
          },
        });
      }
    } catch (replyError) {
      triggerErrorEmbed(replyError, {
        userId: message.author?.id,
        source: 'specialCommandHandler.js',
        action: 'handleHypeProtectCommand_reply',
      });
    }
  } catch (e) {
    triggerErrorEmbed(e, {
      userId: message.author?.id,
      source: 'specialCommandHandler.js',
      action: 'handleHypeProtectCommand_fetch',
    });
    try {
      const messageExists = await message.channel.messages
        .fetch(message.id)
        .catch(() => null);
      if (messageExists) {
        await safeReply(message, {
          content:
            "Une erreur est survenue lors de la vérification de la présence de l'utilisateur.",
          allowedMentions: {
            parse: [],
          },
        });
      }
    } catch (replyError) {
      triggerErrorEmbed(replyError, {
        userId: message.author?.id,
        source: 'specialCommandHandler.js',
        action: 'handleHypeProtectCommand_errorReply',
      });
    }
  }
};

const handleMessageFilter = async () => false;

const handlePromptInjection = async (message) => {
  const contentLower = message.content.toLowerCase();
  if (!contentLower.includes('||​||')) return false;
  const warningEmbed = new EmbedBuilder()
    .setColor(embedColor)
    .setDescription(
      '<a:warning:1269193959503040553> **Vous avez été signalé** pour tentation de modification de mon comportement et/ou de mes réponses. **Mes créateurs ont été notifiés** et se laissent le droit de vous **bannir de mon utilisation** (blacklist de mes services).',
    );
  try {
    await safeReply(message, {
      embeds: [warningEmbed],
      allowedMentions: {
        parse: [],
      },
    });
  } catch (e) {
    triggerErrorEmbed(e, {
      userId: message.author?.id,
      source: 'specialCommandHandler.js',
      action: 'handlePromptInjection',
    });
  }
  return true;
};

export {
  handleHypeProtectCommand,
  handleMessageFilter,
  handlePromptInjection,
  sendToReportWebhook,
};

