import { EmbedBuilder, WebhookClient } from 'discord.js';
import { embedColor } from '../config/config.js';
import errorData from '../data/errorData.json' with { type: 'json' };
import * as coreUtilsModule from './coreUtils.js';

const coreUtils = coreUtilsModule.default ||
  coreUtilsModule || {
    isValid: {
      object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
      string: (v) => typeof v === 'string' && v.trim().length > 0,
      number: (v) => typeof v === 'number' && !isNaN(v) && isFinite(v),
    },
    sanitize: (str, max = 1000) =>
      typeof str === 'string' ? str.trim().substring(0, max) : '',
  };

const { isValid, sanitize } = coreUtils;

const ERROR_CACHE = new Map();
const CACHE_TTL = 30000;

const isIgnorable = (err) =>
  !isValid.object(err) ||
  errorData.ignorableCodes.includes(err.code) ||
  (isValid.string(err.message) &&
    (err.message.includes('Unknown interaction') ||
      err.message.includes('Interaction has already been acknowledged')));

async function triggerErrorEmbed(error, context = {}) {
  if (!error)
    return {
      userEmbed: null,
      logged: false,
    };

  try {
    if (!(error instanceof Error)) {
      if (isValid.string(error)) error = new Error(sanitize(error));
      else if (isValid.object(error) && isValid.string(error.message)) {
        const newError = new Error(sanitize(error.message));
        newError.code = isValid.number(error.code) ? error.code : undefined;
        newError.name =
          isValid.string(error.name) ? sanitize(error.name) : 'Error';
        error = newError;
      } else
        return {
          userEmbed: null,
          logged: false,
        };
    }

    context = isValid.object(context) ? context : {};
    if (isIgnorable(error))
      return {
        userEmbed: null,
        logged: false,
      };

    const errorKey = `${error.name || 'Error'}-${error.code || 'NoCode'}-${sanitize(error.message || 'NoMessage', 100)}`;
    const cached = ERROR_CACHE.get(errorKey);
    if (cached && isValid.number(cached) && Date.now() - cached < CACHE_TTL)
      return {
        userEmbed: null,
        logged: false,
      };

    ERROR_CACHE.set(errorKey, Date.now());
    setTimeout(() => ERROR_CACHE.delete(errorKey), CACHE_TTL);

    const stack = extractStack(error);
    const userMsg = generateUserMsg(error, context);

    try {
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('🚨 Erreur détectée')
        .setDescription(
          `\`\`\`js\n${sanitize(error.message || 'Erreur inconnue', 1500)}\`\`\``,
        )
        .addFields([
          {
            name: '📍 Localisation',
            value: `**Fichier:** ${stack.file}\n**Ligne:** ${stack.line}\n**Méthode:** ${stack.method}`,
            inline: false,
          },
          {
            name: '🔍 Détails',
            value: `**Type:** ${sanitize(error.name || 'Error', 50)}\n**Code:** ${error.code || 'N/A'}`,
            inline: true,
          },
          {
            name: '🔧 Contexte',
            value: formatContext(context),
            inline: true,
          },
        ])
        .setTimestamp();

      if (
        isValid.string(errorData.webhookUrl) &&
        errorData.webhookUrl.startsWith('https://')
      ) {
        const webhook = new WebhookClient({
          url: errorData.webhookUrl,
        });
        try {
          let avatarURL = `https://cdn.discordapp.com/avatars/1098179232779223080/a_796afb854b65d2ee4b16625054571ee2.gif`;

          await webhook.send({
            username: '🌟~🤖GLaDOS🤖~🌟',
            avatarURL,
            embeds: [embed],
          });
        } catch (webhookErr) {
          if (
            webhookErr.code === 10015 ||
            webhookErr.message?.includes('Unknown Webhook')
          ) {
            console.warn(
              '[GLaDOS] Webhook Discord inconnu ou supprimé (10015).',
            );
          } else {
            console.error(
              "[GLaDOS] Erreur lors de l'envoi du webhook :",
              webhookErr,
            );
          }
        }
      }

      return {
        userEmbed: isValid.string(userMsg) ? createUserEmbed(userMsg) : null,
        logged: true,
      };
    } catch {
      return {
        userEmbed: null,
        logged: false,
      };
    }
  } catch {
    return {
      userEmbed: null,
      logged: false,
    };
  }
}

const createUserEmbed = (msg) =>
  new EmbedBuilder()
    .setColor(embedColor)
    .setDescription(`🔧 ${sanitize(msg, 1000)}`)
    .setTimestamp();

function generateUserMsg(error, context) {
  if (!isValid.object(error)) return errorData.defaultMessages.technicalError;

  if (isValid.number(error.code) && errorData.errorMessages[error.code])
    return errorData.errorMessages[error.code];

  if (error.code === 40333) {
    return errorData.errorMessages['40333'];
  }
  if (isValid.string(error.message)) {
    if (error.message.includes('Missing Permissions'))
      return errorData.defaultMessages.missingPermissions;
    if (error.message.includes('Cannot send messages'))
      return errorData.defaultMessages.cannotSendMessages;
    if (error.message.includes('Unknown interaction')) return null;
  }
  if (isValid.string(context.command))
    return errorData.defaultMessages.commandError.replace(
      '{command}',
      sanitize(context.command, 50),
    );
  return errorData.defaultMessages.technicalError;
}

function extractStack(error) {
  const def = {
    file: 'Inconnu',
    line: 'N/A',
    method: 'Inconnu',
  };
  if (!isValid.object(error) || !isValid.string(error.stack)) return def;

  try {
    const lines = error.stack
      .split('\n')
      .filter((line) => isValid.string(line));
    const relevantLine = lines.find(
      (line) =>
        (line.includes('.js') ||
          line.includes('.ts') ||
          line.match(/at\s+\S+\s+\((.*):\d+:\d+\)/) ||
          line.match(/at\s+(.*):\d+:\d+/)) &&
        !line.includes('node_modules') &&
        !line.includes('node:internal'),
    );

    if (!isValid.string(relevantLine)) return def;

    const fileMatch = relevantLine.match(/at\s+(.*?)\s+\((.*):(\d+):(\d+)\)/);
    if (fileMatch && fileMatch.length >= 4) {
      return {
        file:
          isValid.string(fileMatch[2]) ?
            fileMatch[2].split(/[/]/).pop()
          : 'Inconnu',
        line: isValid.string(fileMatch[3]) ? fileMatch[3] : 'N/A',
        method:
          isValid.string(fileMatch[1]) ?
            sanitize(fileMatch[1], 100)
          : 'Fonction anonyme',
      };
    }

    const simpleMatch = relevantLine.match(/at\s+(.*):(\d+):(\d+)/);
    if (simpleMatch && simpleMatch.length >= 3) {
      return {
        file:
          isValid.string(simpleMatch[1]) ?
            simpleMatch[1].split(/[/]/).pop()
          : 'Inconnu',
        line: isValid.string(simpleMatch[2]) ? simpleMatch[2] : 'N/A',
        method: 'Fonction globale',
      };
    }

    return def;
  } catch {
    return def;
  }
}

function formatContext(context) {
  if (!isValid.object(context)) return 'Aucun contexte';
  const lines = [];
  if (isValid.string(context.command))
    lines.push(`Commande: ${sanitize(context.command, 100)}`);
  if (isValid.object(context.args))
    lines.push(`Arguments: ${JSON.stringify(context.args)}`);
  if (isValid.string(context.user))
    lines.push(`Utilisateur: ${sanitize(context.user, 100)}`);
  if (isValid.string(context.guild))
    lines.push(`Serveur: ${sanitize(context.guild, 100)}`);
  if (isValid.string(context.userId)) lines.push(`User ID: ${context.userId}`);
  if (isValid.string(context.channelId))
    lines.push(`Channel ID: ${context.channelId}`);
  if (isValid.string(context.guildId))
    lines.push(`Guild ID: ${context.guildId}`);
  return lines.length ? lines.join('\n') : 'Aucun contexte';
}

process.on('unhandledRejection', (reason) => {
  if (!reason) return;

  if (reason instanceof Error) {
    if (
      reason.message === 'Authentication failed' ||
      reason.message.includes('Authentication failed') ||
      reason.message.includes('Invalid token') ||
      reason.message.includes('401: Unauthorized')
    ) {
      console.error(
        "🚨 Erreur d'authentification Discord détectée:",
        reason.message,
      );
      console.error('📋 Vérifiez que votre token Discord est valide et actif');
      console.error('🔄 Le bot va tenter de se reconnecter automatiquement...');
      return;
    }

    if (
      reason.message.includes('WebSocket') ||
      reason.message.includes('gateway') ||
      reason.message.includes('connection')
    ) {
      console.warn('⚠️ Erreur de connexion WebSocket Discord:', reason.message);
      console.warn('🔄 Reconnexion automatique en cours...');
      return;
    }
  }

  if (
    reason &&
    typeof reason === 'object' &&
    errorData.ignorableCodes.includes(reason.code)
  ) {
    return;
  }

  if (reason instanceof Error) {
    triggerErrorEmbed(reason, {
      command: 'UnhandledRejection',
    });
  }
});

process.on('uncaughtException', (error) => {
  if (
    !error ||
    typeof error !== 'object' ||
    errorData.ignorableCodes.includes(error.code)
  )
    return;
  if (error.message && typeof error.message === 'string') {
    if (
      error.message.includes('Cannot read properties of null') ||
      error.message.includes('Unknown message')
    )
      return;
  }
  if (Math.random() < 0.1)
    triggerErrorEmbed(error, {
      command: 'UncaughtException',
    });
});

export default triggerErrorEmbed;

