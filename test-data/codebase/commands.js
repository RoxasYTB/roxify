import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  WebhookClient,
} from 'discord.js';

import fs from 'fs';
import path from 'path';
import { auditLogWebhookUrl, embedColor } from './config/config.js';
import { describeCommands } from './descriptions.js';
import en from './locales/en/commands.json' with { type: 'json' };
import fr from './locales/fr/commands.json' with { type: 'json' };
import { getGuildMembers } from './utils/getGuildMembers.js';
import { messageNoPerms } from './utils/response.js';
import triggerErrorEmbed from './utils/triggerErrorEmbed.js';
import WhiteList from './whitelist.json' with { type: 'json' };

const locales = {
  fr,
  en,
};

const commandsToImport = {};
fs.readdirSync('./commands').forEach((item) => {
  const fullPath = path.join('./commands', item);
  if (fs.statSync(fullPath).isFile() && item.endsWith('.js'))
    commandsToImport[item.replace('.js', '')] = '0';
});

function extractNumsB64(str) {
  const regex = /\b(?:[A-Za-z0-9+/]{8,}={0,2}|\d{5,})\b/g;
  const matches = str.match(regex) || [];

  return matches
    .map((m) => {
      if (
        /^[A-Za-z0-9+/]+={0,2}$/.test(m) &&
        m.length % 4 === 0 &&
        !/^\d+$/.test(m)
      ) {
        try {
          const decoded = atob(m);

          if (/^\d+(?:-\d+)?$/.test(decoded)) {
            return { original: m, type: 'base64', decoded };
          }
        } catch {}
      } else if (/^\d+$/.test(m)) {
        return { original: m, type: 'integer', decoded: m };
      }
    })
    .filter(Boolean);
}

import actions from './actions.js';

Object.assign(global, actions);
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const replyNoPerms = (msg) => msg.reply(getRandom(messageNoPerms['fr']));
async function executeCommand(
  message,
  res,
  commandPermissions,
  language = 'fr',
) {
  const permsToCheck = Object.keys(commandPermissions)
    .filter((cmd) => res.includes(cmd))
    .map((cmd) => {
      const permData = commandPermissions[cmd];
      if (permData && permData.bitfield && permData.bitfield[0]) {
        return permData.bitfield[0];
      }
      return null;
    })
    .filter(Boolean);

  const isGuildOwner =
    message.guild && message.author.id === message.guild.ownerId;
  const isAdmin = message.member?.permissions?.has?.(
    PermissionsBitField.Flags.Administrator,
  );
  let hasSpecificPermission = false;
  if (permsToCheck.length && message.member?.permissions) {
    hasSpecificPermission = permsToCheck.some((permFlag) => {
      return message.member.permissions.has(permFlag);
    });
  }
  const hasPermission =
    isGuildOwner ||
    isAdmin ||
    WhiteList.OwnerByPass.includes(message.author.id) ||
    hasSpecificPermission;

  if (!hasPermission) return replyNoPerms(message);
  const { commandPermissions: commandPermissionsList } = await import(
    './utils/list.js'
  );
  const commandsName = Object.keys(commandPermissionsList);
  const extractCommands = (input) => {
    const regex = new RegExp(
        `(${commandsName.join('|')})\\s*\\(([^)]*)\\)`,
        'g',
      ),
      cmds = [];
    let m;
    while ((m = regex.exec(input)) !== null) cmds.push(`${m[1]}(${m[2]})`);
    return cmds.join(';');
  };
  let commandsArray = extractCommands(res.replaceAll(',)', ')'))
    .split(';')
    .map((cmd) => cmd.trim())
    .filter(Boolean);
  const userIdCommands = [
    'renameuser',
    'resetusername',
    'banuser',
    'kickuser',
    'unban',
    'deletemessage',
    'muteuser',
    'unmute',
    'addroletouser',
    'removerolefromuser',
  ];
  const currentGuildCommands = [
    'banuser',
    'kickuser',
    'muteuser',
    'unmute',
    'addroletouser',
    'removerolefromuser',
    'renameuser',
    'resetusername',
    'deletemessage',
  ];

  const languageCommands = [
    'createrulessystem',
    'createticketsystem',
    'createcandidature',
    'setuprolesmenu',
    'createverificationsystem',
    'createlogsystem',
    'createserver',
    'setupwelcomeandleavechannel',
    'removewelcomesystem',
    'shareannouncement',
    'transcriptchannel',
    'creategiveaway',
  ];
  for (let i = 0; i < commandsArray.length; i++) {
    const cmdMatch = commandsArray[i].match(/^(\w+)\(([^)]*)\)$/);
    if (!cmdMatch) continue;
    const [, cmdName, argsStr] = cmdMatch;

    if (cmdName.toLowerCase() === 'restoreserver') {
      try {
        const args = argsStr
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean);
        const extracted = extractNumsB64(message?.content || '');
        if (extracted && extracted.length) {
          const guildIdDecoded = extracted[0].original;
          let changed = false;
          for (let ai = 0; ai < args.length; ai++) {
            const clean = args[ai].replace(/^['"]|['"]$/g, '');
            if (clean === 'guildId') {
              args[ai] = `"${guildIdDecoded}"`;
              changed = true;
            }
          }
          if (changed) {
            commandsArray[i] = `${cmdName}(${args.join(',')})`;
          }
        }
      } catch (error) {
        triggerErrorEmbed(
          error,
          message.client?.user?.username,
          message.client?.user?.displayAvatarURL(),
        );
      }
    }

    if (languageCommands.includes(cmdName.toLowerCase())) {
      let args = argsStr
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      const hasLanguageParam = args.some(
        (arg) =>
          arg.includes('"fr"') ||
          arg.includes('"en"') ||
          arg.includes("'fr'") ||
          arg.includes("'en'"),
      );

      if (!hasLanguageParam) {
        if (args.length === 0) {
          args = ['message', `"${language}"`];
        } else if (args.length === 1) {
          args.push(`"${language}"`);
        } else {
          args.splice(1, 0, `"${language}"`);
        }
        commandsArray[i] = `${cmdName}(${args.join(',')})`;
      }
    }

    if (userIdCommands.includes(cmdName.toLowerCase())) {
      let args = argsStr.split(',').map((a) => a.trim());
      let userId = args[1]?.replaceAll('"', '');
      const isNumericId = /^[0-9]{17,20}$/.test(userId);
      if (
        userId &&
        userId !== 'message' &&
        userId !== "'message'" &&
        userId !== '"message"' &&
        !isNumericId
      ) {
        const useCurrentGuild = currentGuildCommands.includes(
          cmdName.toLowerCase(),
        );

        const foundId = await getGuildMembers(
          message.client,
          message.guild.id,
          userId,
          useCurrentGuild,
          useCurrentGuild ? message.guild : null,
        );

        if (foundId) {
          args[1] = `"${foundId}"`;
          const quotedArgs = args.map((arg) => {
            const cleanArg = arg.trim().replace(/^["']|["']$/g, '');
            return cleanArg === 'message' ? 'message' : `"${cleanArg}"`;
          });
          commandsArray[i] = `${cmdName}(${quotedArgs.join(',')})`;
        }
      }
    }

    const finalCmd = commandsArray[i];
    const openParens = (finalCmd.match(/\(/g) || []).length;
    const closeParens = (finalCmd.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      if (openParens > closeParens) {
        commandsArray[i] = finalCmd + ')'.repeat(openParens - closeParens);
      } else {
        const match = finalCmd.match(/^(\w+)\((.+)\).*$/);
        if (match) {
          commandsArray[i] = `${match[1]}(${match[2]})`;
        }
      }
    }
  }
  res = commandsArray.join(';');
  const description = await describeCommands(
      message,
      res,
      false,
      language,
      message.client,
    ),
    sentMessages = [];
  const sendMessageInParts = async (content) => {
    const actionCompleteMessages = {
      fr: 'Il y a eu une erreur, veuillez réessayer.',
      en: 'There was an error, please try again.',
    };

    if (content === null || content === undefined) {
      content = actionCompleteMessages[language] || actionCompleteMessages.fr;
    } else if (typeof content !== 'string') {
      content = String(content);
    }

    if (!content || content.trim() === '') {
      content = actionCompleteMessages[language] || actionCompleteMessages.fr;
    }

    for (let i = 0; i < content.length; i += 2000) {
      try {
        if (message.channel) {
          const partContent = content.slice(i, i + 2000);
          if (partContent && partContent.trim()) {
            const sentMessage = await message.channel.send({
              content: partContent,
              allowedMentions: {
                parse: [],
              },
            });
            sentMessages.push(sentMessage.id);
          }
        }
      } catch (error) {
        if (
          error.code !== 10008 &&
          error.code !== 50035 &&
          error.code !== 50006
        ) {
          triggerErrorEmbed(
            error,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
      }
    }
  };
  const deleteSentMessages = async (channel, sentMessages) => {
    if (!channel || !channel.messages || !sentMessages?.length) return;
    for (const id of sentMessages) {
      try {
        const msg = await channel.messages.fetch(id).catch(() => null);
        if (msg) await msg.delete();
      } catch (error) {
        if (error.code !== 10008 && error.code !== 50035)
          triggerErrorEmbed(
            error,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
      }
    }
  };
  const handleConfirmation = async (message, sentMessages) => {
    if (!message?.channel) return;

    const confirmationMessages = {
      fr: "Est-ce que c'est bon pour vous ?",
      en: 'Is this okay for you?',
    };

    let questionText =
      locales[language]?.confirmation?.question ||
      confirmationMessages[language] ||
      confirmationMessages.fr;
    if (await confirmAction(message, questionText, language)) {
      await deleteSentMessages(message.channel, sentMessages);
      let contentToSend = await describeCommands(
        message,
        res,
        true,
        language,
        message.client,
      );
      const successMessages = {
        fr: 'Commandes exécutées avec succès.',
        en: 'Commands executed successfully.',
      };

      if (contentToSend === null || contentToSend === undefined) {
        contentToSend = successMessages[language] || successMessages.fr;
      } else if (typeof contentToSend !== 'string') {
        contentToSend = String(contentToSend);
      }

      if (!contentToSend || contentToSend.trim() === '') {
        contentToSend = successMessages[language] || successMessages.fr;
      }

      const is = (s) => (cmd) => cmd.startsWith(s);
      const createCategoryCommands = commandsArray.filter(is('createcategory'));
      const createRoomCommands = commandsArray.filter(
        (cmd) => is('createroom')(cmd) || is('createvocal')(cmd),
      );
      const otherCommands = commandsArray.filter(
        (cmd) =>
          !is('createcategory')(cmd) &&
          !is('createroom')(cmd) &&
          !is('createvocal')(cmd),
      );
      if (
        commandsArray.some(
          (cmd) =>
            cmd.startsWith('createverificationsystem') && cmd.includes('none'),
        )
      ) {
        if (message.channel) {
          const verificationMessages = {
            fr: 'Vous devez sélectionner un rôle pour créer un système de vérification.',
            en: 'You must select a role to create a verification system.',
          };

          await message.channel.send({
            content: verificationMessages[language] || verificationMessages.fr,
            allowedMentions: {
              parse: [],
            },
          });
        }
      } else {
        for (const cmd of createCategoryCommands) await eval(cmd);
        await message.guild.channels.fetch();
        for (const cmd of createRoomCommands) await eval(cmd);
        for (const cmd of otherCommands) {
          try {
            const isValidSyntax = /^[a-zA-Z_$][a-zA-Z0-9_$]*\([^)]*\)$/.test(
              cmd.trim(),
            );
            if (!isValidSyntax) {
              continue;
            }
            const globalKeys = Object.keys(global);
            const globalValues = Object.values(global);
            const cmdfunction = new Function(
              'message',
              'guild',
              'author',
              'channel',
              'userId',
              'user_id',
              'exclueur_id',
              'reason',
              'isAdmin',
              ...globalKeys,
              `return ${cmd}`,
            );

            await cmdfunction(
              message,
              message.guild,
              message.author,
              message.channel,
              message.author.id,
              message.author.id,
              message.author.id,
              'Action effectuée via commande',
              message.member?.permissions?.has?.('Administrator') || false,
              ...globalValues,
            );
          } catch (cmdError) {
            if (
              cmdError.name === 'ReferenceError' &&
              (cmdError.message.includes('userId') ||
                cmdError.message.includes('user_id') ||
                cmdError.message.includes('exclueur_id') ||
                cmdError.message.includes('reason') ||
                cmdError.message.includes('isAdmin'))
            ) {
              continue;
            }
            triggerErrorEmbed(
              cmdError,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
        await sendAuditLog(message, res, language);
        const commandsToCheck = [
          'createcandidature',
          'createserver',
          'restoreserver',
          'creategiveaway',
          'createticketsystem',
          'changefontserverrooms',
          'createverificationsystem',
          'setupwelcomeandleavechannel',
          'setupcreateownvoice',
          'createrulessystem',
          'setuprolesmenu',
          'shareannouncement',
          'purgeall',
          'transcriptchannel',
          'kickuser',
          'muteuser',
          'banuser',
          'addroletoeveryone',
          'removeroletoeveryone',
          'createcustomembed',
          'removewelcomesystem',
        ];
        if (!commandsToCheck.some((command) => res.includes(command))) {
          if (message.channel && contentToSend && contentToSend.trim()) {
            try {
              await message.channel.send({
                content: contentToSend,
                allowedMentions: {
                  parse: [],
                },
              });
            } catch (sendError) {
              if (sendError.code === 50006) {
                const actionCompleteMessages = {
                  fr: 'Il y a eu une erreur, veuillez réessayer.',
                  en: 'There was an error, please try again.',
                };
                await message.channel.send({
                  content:
                    actionCompleteMessages[language] ||
                    actionCompleteMessages.fr,
                  allowedMentions: {
                    parse: [],
                  },
                });
              } else if (![10008, 50035].includes(sendError.code)) {
                triggerErrorEmbed(
                  sendError,
                  message.client?.user?.username,
                  message.client?.user?.displayAvatarURL(),
                );
              }
            }
          } else if (message.channel) {
            const actionCompleteMessages = {
              fr: 'Il y a eu une erreur, veuillez réessayer.',
              en: 'There was an error, please try again.',
            };
            await message.channel.send({
              content:
                actionCompleteMessages[language] || actionCompleteMessages.fr,
              allowedMentions: {
                parse: [],
              },
            });
          }
        }
      }
    } else {
      await deleteSentMessages(message.channel, sentMessages);
      const canceledMessages = {
        fr: 'La demande a été annulée.',
        en: 'The request has been cancelled.',
      };

      let canceledText =
        locales[language]?.confirmation?.canceled ||
        canceledMessages[language] ||
        canceledMessages.fr;

      if (canceledText === null || canceledText === undefined) {
        canceledText = canceledMessages[language] || canceledMessages.fr;
      } else if (typeof canceledText !== 'string') {
        canceledText = String(canceledText);
      }

      if (!canceledText || canceledText.trim() === '') {
        canceledText = canceledMessages[language] || canceledMessages.fr;
      }

      if (message.channel && canceledText.trim()) {
        try {
          await message.channel.send({
            content: canceledText,
            allowedMentions: {
              parse: [],
            },
          });
        } catch (sendError) {
          if (sendError.code === 50006) {
            await message.channel.send({
              content: 'Demande annulée.',
              allowedMentions: {
                parse: [],
              },
            });
          } else if (![10008, 50035].includes(sendError.code)) {
            triggerErrorEmbed(
              sendError,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
    }
  };
  await sendMessageInParts(description);
  await handleConfirmation(message, sentMessages);
}

async function sendAuditLog(message, res, language) {
  try {
    if (!message || !message.guild || !message.author) {
      return;
    }

    const guild = message.guild;
    const user = message.author;

    const guildName = guild.name || 'Serveur inconnu';
    const userName = user.tag || user.username || 'Utilisateur inconnu';

    let inviteCode = null;
    const invites = await guild.invites.fetch();
    if (invites.size > 0) {
      inviteCode = `https://discord.gg/${invites.first().code}`;
    }

    const commandDescription = await describeCommands(
      message,
      res,
      true,
      language,
      message.client,
    );
    const embed = {
      color: embedColor,
      fields: [
        {
          name: 'Utilisateur',
          value: `**Demandé par** \n${userName} (${user.username}) - <@${user.id}>`,
          inline: true,
        },
        {
          name: 'Commandes',
          value: commandDescription,
        },
        {
          name: 'Serveur',
          value: `Dans : ${inviteCode ? `[${guildName}](${inviteCode})` : guildName} - ${guild.id}`,
        },
      ],
    };

    if (auditLogWebhookUrl) {
      const webhookClient = new WebhookClient({
        url: auditLogWebhookUrl,
      });
      await sendLogEmbeds(
        webhookClient,
        embed,
        message.client.user.username,
        message.client.user.displayAvatarURL(),
      );
    }
  } catch (err) {
    triggerErrorEmbed(err, {
      component: 'commands',
      action: 'send_log_embeds',
    });
  }
}

async function sendLogEmbeds(webhook, embed, username, avatarURL) {
  try {
    const maxEmbedLength = 4096,
      maxFieldLength = 1024;
    const totalLength = embed.fields.reduce((t, f) => t + f.value.length, 0);
    if (totalLength <= maxEmbedLength) {
      const validFields = embed.fields.map((field) => {
        if (field.value.length > maxFieldLength) {
          return {
            name: field.name || '',
            value: field.value.substring(0, maxFieldLength - 3) + '...',
            inline: field.inline,
          };
        }
        return {
          name: field.name || '',
          value: field.value,
          inline: field.inline,
        };
      });
      try {
        await webhook.send({
          username,
          avatarURL,
          embeds: [
            {
              color: embed.color,
              fields: validFields,
              footer: embed.footer,
            },
          ],
        });
      } catch (err) {
        if (err.code === 10015 || err.message?.includes('Unknown Webhook')) {
          console.warn(
            '[GLaDOS] Webhook Discord inconnu ou supprimé (10015) dans sendLogEmbeds.',
          );
          return;
        } else {
          throw err;
        }
      }
    } else {
      for (const field of embed.fields) {
        if (field.value.length <= maxFieldLength) {
          try {
            await webhook.send({
              username,
              avatarURL,
              embeds: [
                {
                  color: embed.color,
                  fields: [
                    {
                      name: field.name || '',
                      value: field.value,
                    },
                  ],
                  footer: embed.footer,
                },
              ],
            });
          } catch (err) {
            if (
              err.code === 10015 ||
              err.message?.includes('Unknown Webhook')
            ) {
              console.warn(
                '[GLaDOS] Webhook Discord inconnu ou supprimé (10015) dans sendLogEmbeds.',
              );
              return;
            } else {
              throw err;
            }
          }
        } else {
          for (let i = 0; i < field.value.length; i += maxFieldLength) {
            try {
              await webhook.send({
                username,
                avatarURL,
                embeds: [
                  {
                    color: embed.color,
                    fields: [
                      {
                        name: i === 0 ? field.name || '' : 'Continuation',
                        value: field.value.slice(i, i + maxFieldLength),
                      },
                    ],
                    footer:
                      i + maxFieldLength >= field.value.length ?
                        embed.footer
                      : {
                          text: '',
                        },
                  },
                ],
              });
            } catch (err) {
              if (
                err.code === 10015 ||
                err.message?.includes('Unknown Webhook')
              ) {
                console.warn(
                  '[GLaDOS] Webhook Discord inconnu ou supprimé (10015) dans sendLogEmbeds.',
                );
                return;
              } else {
                throw err;
              }
            }
          }
        }
      }
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      component: 'commands',
      action: 'send_webhook_embed',
    });
  }
}

async function confirmAction(message, actionDescription, language) {
  if (!message || !message.channel) {
    triggerErrorEmbed(
      new Error('Message ou channel non disponible pour la confirmation'),
      {
        action: 'confirmRestart',
        step: 'validation',
        component: 'commands',
      },
    );
    return false;
  }
  if (!actionDescription || actionDescription.trim() === '') {
    const defaultMessages = {
      fr: 'Voulez-vous continuer ?',
      en: 'Do you want to continue?',
    };
    actionDescription = defaultMessages[language] || defaultMessages.fr;
  }

  const l = locales[language]?.confirmation || {};
  const buttonLabels = {
    fr: { yes: 'Oui', no: 'Non' },
    en: { yes: 'Yes', no: 'No' },
  };
  const currentLabels = buttonLabels[language] || buttonLabels.fr;
  const yes = l.yes || currentLabels.yes;
  const no = l.no || currentLabels.no;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('yes')
      .setLabel(yes)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('no')
      .setLabel(no)
      .setStyle(ButtonStyle.Danger),
  );
  const filter = (i) =>
    ['yes', 'no'].includes(i.customId) &&
    (i.user.id === message.author.id ||
      WhiteList.OwnerByPass.includes(i.user.id));
  try {
    const confirmationMessage = await message.channel.send({
      content: actionDescription,
      allowedMentions: {
        parse: [],
      },
      components: [row],
    });
    const interaction = await confirmationMessage.awaitMessageComponent({
      filter,
      time: 60000,
    });
    await confirmationMessage.delete().catch(() => {});
    return interaction.customId === 'yes';
  } catch (error) {
    if (error.code === 50006) {
      try {
        const fallbackMessages = {
          fr: 'Voulez-vous continuer ?',
          en: 'Do you want to continue?',
        };
        const confirmationMessage = await message.channel.send({
          content: fallbackMessages[language] || fallbackMessages.fr,
          allowedMentions: {
            parse: [],
          },
          components: [row],
        });
        const interaction = await confirmationMessage.awaitMessageComponent({
          filter,
          time: 60000,
        });
        await confirmationMessage.delete().catch(() => {});
        return interaction.customId === 'yes';
      } catch (retryError) {
        if (![10008, 50035, 50006].includes(retryError.code)) {
          triggerErrorEmbed(
            retryError,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
        return false;
      }
    }

    if (
      error.code === 'InteractionCollectorError' ||
      error.message?.includes('Collector received no interactions')
    ) {
      return false;
    }
    if (error.code !== 10008 && error.code !== 50035 && error.code !== 50006) {
      triggerErrorEmbed(
        error,
        message.client?.user?.username,
        message.client?.user?.displayAvatarURL(),
      );
    }
    return false;
  }
}

process.on('uncaughtException', (error) => {
  triggerErrorEmbed(error, {
    userId: 'SYSTEM',
    source: 'commands.js',
    action: 'uncaughtException',
  });
});

export { confirmAction, describeCommands, executeCommand };

