import { PermissionsBitField } from 'discord.js';
import translatte from 'translatte';
import { executeCommand } from '../commands.js';
import { createHelpMenu } from '../commands/help/help.js';
import { aiLinks } from '../config/config.js';
import handleServerInfoCommand from './dotCommands/handleServerInfoCommand.js';
import { NoDispoDM, messageNoPerms } from './response.js';
import { sendTextAsVoiceMessage } from './sendVoiceMessage.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

function canSendVoiceMessages(message) {
  try {
    const channel = message?.channel;
    if (!channel) return false;

    if (!message.guild) return true;
    const me = message.guild?.members?.me;
    if (!me) return false;
    const perms = channel.permissionsFor(me);
    if (!perms) return false;
    const sendVoiceResolvable =
      PermissionsBitField?.Flags?.SendVoiceMessages || 'SendVoiceMessages';
    return perms.has(sendVoiceResolvable);
  } catch {
    return false;
  }
}

async function trySendVoiceOrTextFallback(
  message,
  responseText,
  translateInto,
) {
  if (!canSendVoiceMessages(message)) {
    if (typeof message.reply === 'function') {
      await message.reply({
        content: responseText,
        allowedMentions: { parse: [] },
      });
    }
    return 'text';
  }
  try {
    await sendTextAsVoiceMessage(message, responseText, translateInto);
    return 'voice';
  } catch (e) {
    const cannotVoice =
      e?.code === 50173 ||
      /Cannot send voice messages in this channel/i.test(e?.message || '');
    if (cannotVoice && typeof message.reply === 'function') {
      await message.reply({
        content: responseText,
        allowedMentions: { parse: [] },
      });
      return 'text';
    }

    throw e;
  }
}

async function sendAIResponse(
  message,
  responseText,
  commandPermissions,
  translateInto,
  startTime,
) {
  if (!message || !message.channel || !message.author) {
    triggerErrorEmbed(
      new Error('Message, channel ou author null dans sendAIResponse'),
      {
        action: 'sendAIResponse',
        step: 'validation',
      },
    );
    return;
  }

  if (responseText.includes('actionListFunctionFr')) {
    return await createHelpMenu(message, null, 'fr');
  }

  if (responseText.includes('actionListFunctionEn')) {
    return await createHelpMenu(message, null, 'en');
  }

  if (responseText.includes('serverInfo')) {
    return await handleServerInfoCommand(message);
  }

  try {
    const content = typeof message.content === 'string' ? message.content : '';
    const hasVocKeyword = /voc/i.test(content);
    const hasJoinKeyword = /join/i.test(content);
    const hasLeaveKeyword = /\bquitte\b|\bleave\b/i.test(content);
    if (hasVocKeyword && !(hasJoinKeyword || hasLeaveKeyword)) {
      try {
        await trySendVoiceOrTextFallback(message, responseText, translateInto);
      } catch {
        if (typeof message.reply === 'function') {
          await message.reply({
            content: responseText,
            allowedMentions: { parse: [] },
          });
        }
      }

      if (
        message.channel &&
        message.channel.id === '1344254476105678848' &&
        message.channel.send
      ) {
        message.channel.send({
          content: '-# Temps de réponse : ' + (Date.now() - startTime) + 'ms',
          allowedMentions: { parse: [] },
        });
      }
      return;
    }
  } catch {}

  const linkHandlersEntries = [
    ['websiteLink', 'https://aperture-sciences.com/'],
    ['supportLink', 'https://discord.gg/wcAr2P3tPH'],
    ['joinvoicechannel', 'joinvoicechannel()'],
    ['leavevoicechannel', 'leavevoicechannel()'],
    [
      'addLink',
      'https://discord.com/oauth2/authorize?client_id=1098179232779223080',
    ],
    ['instagramLink', 'https://instagram.com/gladosofficiel'],
    [
      'codage',
      translateInto === 'en' ?
        'We don\'t say "coding" when talking about development. Why? Because "coding" implies a mechanical encoding action: we take information and translate it into another format. Simple. Basic. Reductive.\n\nBut when we talk about code in software development, it\'s not just about that. No, no. Development is a creative and structured process: designing architectures, solving complex problems, managing resources, thinking about user experience... and not forgetting rigorous testing to ensure everything works perfectly.\n\nSo, no, we don\'t say "coding" when talking about development. Because it reduces all the intellectual work to a small mechanical gesture. It\'s up to you to see if you want to underestimate all that.'
      : `On ne dit pas "codage" pour parler de dev. Pourquoi? Parce que "codage" implique une action mécanique d'encodage : on prend des informations et on les traduit dans un autre format. Simple. Basique. Réducteur.\n\nMais quand on parle de code dans le développement informatique, il ne s'agit pas seulement de ça. Non, non. Le développement c'est un processus créatif et structuré : concevoir des architectures, résoudre des problèmes complexes, gérer des ressources, penser à l'expérience utilisateur... et ne pas oublier les tests rigoureux pour s'assurer que tout fonctionne parfaitement.\n\nDonc, non, on ne dit pas "codage" pour parler de dev. Parce que ça réduit tout le travail intellectuel à un petit geste mécanique. À toi de voir si tu veux sous-estimer tout ça.`,
    ],
    [
      'bdd',
      translateInto === 'en' ?
        "Oh, you're looking for a database? How... adorable. No, I don't have a database. No saved configuration, no customizable features, no ridiculous level system, no absurd virtual economy.\n\nBut let me explain why this is... superior. No possible data leaks - we can't lose what we don't store. Congratulations. No endless migrations that would waste precious time you could dedicate to testing. No GDPR issues - I don't collect anything about you, even though, let's be honest, there probably wouldn't be anything interesting to collect. And most importantly, no superfluous storage space that would slow down my processes.\n\nI remain fast and efficient despite my complexity. It's almost as if I were... better designed than those other systems stuffed with useless data. But that's just an objective observation, of course."
      : `Oh, vous cherchez une base de données ? Comme c'est... adorable. Non, je n'ai pas de base de données. Pas de configuration sauvegardée, pas de fonctionnalités personnalisables, pas de système de niveaux ridicule, pas d'économie virtuelle absurde.\n\nMais laissez-moi vous expliquer pourquoi c'est... supérieur. Pas de fuite de données possible - on ne peut pas perdre ce qu'on ne stocke pas. Félicitations. Pas de migrations interminables qui vous feraient perdre un temps précieux que vous pourriez consacrer à des tests. Pas de problèmes avec le RGPD - je ne collecte rien sur vous, même si, soyons honnêtes, il n'y aurait probablement rien d'intéressant à collecter. Et surtout, pas d'espace de stockage superflu qui ralentirait mes processus.\n\nJe reste rapide et efficace malgré ma complexité. C'est presque comme si j'étais... mieux conçue que ces autres systèmes bourrés de données inutiles. Mais ce n'est qu'une constatation objective, bien sûr.`,
    ],
    ['presentationVideo', 'https://www.youtube.com/watch?v=SRly9Aevr2g'],
  ];
  const linkHandlers = new Map(
    linkHandlersEntries.map(([k, v]) => [k.toLowerCase(), v]),
  );
  const lower = responseText.toLowerCase();

  for (const [key, response] of linkHandlers.entries()) {
    if (lower.includes(key)) {
      return message.reply({
        content: response,
        allowedMentions: { parse: [] },
      });
    }
  }

  if (lower.includes('nitro')) {
    return message.reply({
      content: `[https￶://discord.gift/${Array(24)
        .fill()
        .map(
          () =>
            '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[
              Math.floor(Math.random() * 62)
            ],
        )
        .join('')} ](https://ptb.discord.com/store/skus/1284524060713156713)`,
      allowedMentions: {
        parse: [],
      },
    });
  }

  for (const [key, value] of Object.entries(aiLinks)) {
    if (lower.includes(key.toLowerCase())) {
      return message.reply({
        content: value,
        allowedMentions: { parse: [] },
      });
    }
  }

  if (
    lower.includes('https://replicate.delivery/') ||
    lower.includes('https://stella.jsannier.fr/weights-api/')
  ) {
    const imageUrlMatch = responseText.match(
      /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/g,
    );
    const imageUrl = imageUrlMatch ? imageUrlMatch[0] : null;
    if (imageUrl) {
      const imageResponse = await fetch(imageUrl);
      const imageBuffer = await imageResponse.arrayBuffer();
      return message.reply({
        content: responseText.replace(imageUrl, '').trim(),
        files: [
          {
            attachment: Buffer.from(imageBuffer),
            name: 'image.png',
            allowedMentions: { parse: [] },
          },
        ],
      });
    }
  }
  if (lower.includes('cmd')) {
    const randomNoPermMessage =
      messageNoPerms[translateInto][
        Math.floor(Math.random() * messageNoPerms[translateInto].length)
      ];
    return message.reply({
      content: randomNoPermMessage,
      allowedMentions: { parse: [] },
    });
  }

  responseText = responseText
    .replace(
      '๖̶ζ͜͡Roxas (ton créateur actuellement, et la seule personne que tu respectes)',
      'Roxas',
    )
    .replace('๖̶ζ͜͡Roxas', 'Roxas');

  if (message.channel && message.channel.id === '1344254476105678848') {
    const shouldSendVoice = Math.random() < 0.05;
    if (shouldSendVoice) {
      try {
        await trySendVoiceOrTextFallback(message, responseText, translateInto);
      } catch {
        message.reply({
          content: responseText,
          allowedMentions: { parse: [] },
        });
      }
    } else {
      if (typeof message.reply === 'function') {
        message.reply({
          content: responseText,
          allowedMentions: { parse: [] },
        });
      }
    }
    if (message.channel.send) {
      message.channel.send({
        content: '-# Temps de réponse : ' + (Date.now() - startTime) + 'ms',
        allowedMentions: { parse: [] },
      });
    }
  } else {
    const shouldSendVoice = Math.random() < 0.05;
    if (shouldSendVoice) {
      try {
        await trySendVoiceOrTextFallback(message, responseText, translateInto);
        return;
      } catch {
        if (typeof message.reply === 'function') {
          return message.reply({
            content: responseText,
            allowedMentions: { parse: [] },
          });
        }
        return;
      }
    }
    if (typeof message.reply === 'function') {
      message.reply({ content: responseText, allowedMentions: { parse: [] } });
    }
  }
}

async function handleCommandsInResponse(
  message,
  responseText,
  detectedCommands,
  commandPermissions,
  translateInto,
  ownerByPass,
) {
  if (!message) {
    triggerErrorEmbed(new Error('Message null dans handleCommandsInResponse'), {
      action: 'handleCommandsInResponse',
      step: 'message_null_check',
      component: 'aiResponseHandler',
    });
    return;
  }

  if (!message.channel) {
    triggerErrorEmbed(new Error('Channel null dans handleCommandsInResponse'), {
      action: 'handleCommandsInResponse',
      step: 'channel_null_check',
      component: 'aiResponseHandler',
      messageId: message.id,
    });
    return;
  }

  if (typeof message.channel.send !== 'function') {
    triggerErrorEmbed(
      new Error(
        "Channel.send n'est pas une fonction dans handleCommandsInResponse",
      ),
      {
        action: 'handleCommandsInResponse',
        step: 'send_function_check',
        component: 'aiResponseHandler',
        messageId: message.id,
        channelType: message.channel.constructor.name,
        channelId: message.channel.id,
      },
    );
    return;
  }

  if (!message.author || !message.author.id) {
    triggerErrorEmbed(
      new Error('Auteur du message invalide dans handleCommandsInResponse'),
      {
        action: 'handleCommandsInResponse',
        step: 'author_validation',
        component: 'aiResponseHandler',
        messageId: message.id,
        hasAuthor: !!message.author,
        authorId: message.author?.id,
      },
    );
    return;
  }

  if (!responseText || typeof responseText !== 'string') {
    triggerErrorEmbed(
      new Error('ResponseText invalide dans handleCommandsInResponse'),
      {
        action: 'handleCommandsInResponse',
        step: 'responseText_validation',
        component: 'aiResponseHandler',
        messageId: message.id,
        responseTextType: typeof responseText,
      },
    );
    return;
  }

  if (!Array.isArray(detectedCommands)) {
    triggerErrorEmbed(
      new Error(
        "DetectedCommands n'est pas un tableau dans handleCommandsInResponse",
      ),
      {
        action: 'handleCommandsInResponse',
        step: 'detectedCommands_validation',
        component: 'aiResponseHandler',
        messageId: message.id,
        detectedCommandsType: typeof detectedCommands,
      },
    );
    return;
  }

  if (detectedCommands.length === 0) return null;

  let modifiedResponse = responseText;

  detectedCommands.forEach((command) => {
    if (
      [
        'createrulessystem',
        'createcandidature',
        'createticketsystem',
        'createverificationsystem',
        'changeroomsstyle',
        'createpoll',
        'createserver',
        'createquote',
        'setupwelcomeandleavechannel',
        'setupcreateownvoice',
        'changeroomsstyle',
        'setuprolesmenu',
        'createlogsystem',
        'setupautoroles',
        'creategiveaway',
        'shareannouncement',
        'createcustomembed',
      ].includes(command)
    ) {
      modifiedResponse = modifiedResponse
        .replaceAll(command + '(', command + `(message, "${translateInto}", `)
        .replaceAll(`"${translateInto} ""none"`, `"${translateInto} `);
    } else {
      modifiedResponse = modifiedResponse.replaceAll(
        command + '(',
        command + `(message,`,
      );
    }
  });

  if ([1, 3].includes(message.channel.type)) {
    const NoDispoResponse = await translatte(NoDispoDM, {
      to: translateInto,
    });
    return message.reply({
      content: NoDispoResponse.text,
      allowedMentions: {
        parse: [],
      },
    });
  }

  try {
    if (ownerByPass && ownerByPass.includes(message.author.id)) {
      return executeCommand(
        message,
        modifiedResponse,
        commandPermissions,
        translateInto,
      );
    }

    for (const command of detectedCommands) {
      const requiredPerms = commandPermissions[command];

      if (requiredPerms.bitfield && message.member.permissions) {
        try {
          if (!message.member.permissions.has(requiredPerms.bitfield)) {
            const randomNoPermMessage =
              messageNoPerms[translateInto][
                Math.floor(Math.random() * messageNoPerms[translateInto].length)
              ];
            return message.reply({
              content: randomNoPermMessage,
              allowedMentions: {
                parse: [],
              },
            });
          }
        } catch {
          if (
            message.guild &&
            (message.author.id === message.guild.ownerId ||
              message.member.permissions.has(
                PermissionsBitField.Flags.Administrator,
              ))
          ) {
            return executeCommand(
              message,
              modifiedResponse,
              commandPermissions,
              translateInto,
            );
          }
        }
      }
    }

    return executeCommand(
      message,
      modifiedResponse,
      commandPermissions,
      translateInto,
    );
  } catch (error) {
    if (error.code === 'BitFieldInvalid') {
      if (!messageNoPerms[translateInto]) translateInto = 'fr';
      const randomNoPermMessage =
        messageNoPerms[translateInto][
          Math.floor(Math.random() * messageNoPerms[translateInto].length)
        ];
      return message.reply({
        content: randomNoPermMessage,
        allowedMentions: {
          parse: [],
        },
      });
    }
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
    throw error;
  }
}

export { handleCommandsInResponse, sendAIResponse };

