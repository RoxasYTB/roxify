import { Events, PermissionsBitField } from 'discord.js';
import * as Config from '../config/config.js';
import { buildAIQueryContext } from '../utils/aiQueryBuilder.js';
import {
  handleCommandsInResponse,
  sendAIResponse,
} from '../utils/aiResponseHandler.js';
import {
  detectAntiRaidKeywords,
  getAntiRaidResponse,
} from '../utils/antiRaidDetection.js';
import { updateBlacklist } from '../utils/blacklistManager.js';
import { checkShards } from '../utils/checkShards.js';
import dotCommands from '../utils/dotCommands.js';
import getStatsCommand from '../utils/dotCommands/getStatsCommand.js';
import {
  handleBotMessage,
  handleBotMessages,
} from '../utils/dotCommands/handleBotMessages.js';
import { fetchMetadata } from '../utils/fetchMetadata.js';
import { getServerContextInfo } from '../utils/guildInfoUtils.js';
import {
  checkHarmfulness,
  handleHarmfulMessage,
} from '../utils/harmfulMessageHandler.js';
import { detectLanguage, sansAccents } from '../utils/languageDetection.js';
import { commandPermissions } from '../utils/list.js';
import {
  createHeaders,
  getRandomJoke,
  LINK_KEYS,
} from '../utils/messageConstants.js';
import { logBotTrigger } from '../utils/messageLogging.js';
import messageProcessor from '../utils/messageProcessor.js';
import {
  checkContentTriggers,
  checkEmojiTrigger,
  checkGifTrigger,
  hasMediaContent,
  isBotTriggered,
  processMessageContent,
  setBlacklistCache,
  updateBlacklistCache,
} from '../utils/messageValidation.js';
import { extractServerChannelStyle } from '../utils/roomNameExtractor.js';
import '../utils/specialCommandHandler.js';
import {
  handleMessageFilter,
  handlePromptInjection,
} from '../utils/specialCommandHandler.js';
import { getInsolenceResponse } from '../utils/standardResponses.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';
import whitelistData from '../whitelist.json' with { type: 'json' };

const { handleMessage } = dotCommands;
const { detectCommands, processMessageContext, processResponseText } =
  messageProcessor;

const { BotName, OwnerByPass, WhitelistedBots } = whitelistData;

export const name = Events.MessageCreate;
export async function execute(message, shardId = 0) {
  const channelName = message.channel?.name?.toLowerCase() ?? '';
  const isMediaChannel = [
    'media',
    'photo',
    'selfie',
    'galerie',
    'gallery',
    'image',
    'pic',
    'picture',
    'photos',
    'memes',
  ].some((mot) => channelName.includes(mot));

  const isSystemOrNotMessage =
    message.system || (message.type !== 0 && message.type !== 19);
  const isGuildPaused = Boolean(
    message.guild && shouldPauseGuild(message.guild.id),
  );
  const isExcludedChannel = message.channel?.id === '1369953144515072037';

  if (isMediaChannel && !hasMediaContent(message)) {
    try {
    } catch {}
    return;
  }
  if (isSystemOrNotMessage) return;
  if (isGuildPaused) return;
  if (isExcludedChannel) return;

  const clusterId = message.client.cluster?.id ?? shardId ?? 0;
  if (!checkShards(message, clusterId)) return;

  const handledByFilter = await handleMessageFilter(message);
  const isWhitelistedBot = WhitelistedBots.includes(message.author.id);
  const hasGuild = Boolean(message.guild);

  if (handledByFilter) return;
  if (!hasGuild || isWhitelistedBot) return;
  await handleMessage(message, message.client);
  try {
    await handleBotMessages(message);

    if (message.author.bot) {
      await handleBotMessage(message);
    }
  } catch (err) {
    console.error(
      "[AntiRaid/AntiSpam] Erreur lors de l'appel à handleBotMessages:",
      err,
    );
  }

  try {
    if (!hasGuild || !message.guild.members) return;
    const startTime = Date.now();

    const processedContent = processMessageContent(message);

    if (message.guild && message.guild.id === Config.gladosFilterServerId) {
      const onlyLowercase = (processedContent || '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
      if (onlyLowercase.includes('glados')) {
        try {
          if (message.webhookId) {
            const { isWebhookProtectedFromDeletion } = await import(
              '../utils/handleWebhookRaid.js'
            );
            const isProtected = await isWebhookProtectedFromDeletion(
              message.guild,
              message.webhookId,
            );
            if (isProtected) {
              return;
            }
          }
          await message.delete();
        } catch (error) {
          if (![10008, 50013].includes(error.code)) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
        return;
      }
    }
    const contentLower = sansAccents(processedContent)
      .toLowerCase()
      .replace('ca va', 'ça va');
    const translateInto = detectLanguage(processedContent) || 'fr';
    const botNameLower =
      message.guild.members.me?.nickname?.toLowerCase() || 'glados';

    const [harmfulnessResult, emojiTrigger, gifTrigger] = await Promise.all([
      (async () => {
        if (
          !message.author.bot &&
          processedContent &&
          processedContent.trim().length > 0
        ) {
          try {
            return await checkHarmfulness(processedContent);
          } catch (harmfulError) {
            triggerErrorEmbed(harmfulError, {
              command: 'messageCreate-harmfulnessCheck',
              guildId: message.guild?.id,
              channelId: message.channel?.id,
              userId: message.author?.id,
            });
            return { isHarmful: false };
          }
        }
        return { isHarmful: false };
      })(),
      Promise.resolve(checkEmojiTrigger(processedContent)),
      Promise.resolve(checkGifTrigger(processedContent)),
    ]);

    if (harmfulnessResult.isHarmful) {
      await handleHarmfulMessage(message, translateInto);
      return;
    }

    if (emojiTrigger || gifTrigger) return;

    const botTriggered = isBotTriggered(message, processedContent);
    const blacklistInfo = updateBlacklistCache();
    if (blacklistInfo.needsUpdate) {
      try {
        const newBlacklistData = await updateBlacklist(message.client);
        setBlacklistCache(newBlacklistData);
      } catch (error) {
        triggerErrorEmbed(error, {
          command: 'messageCreate-updateBlacklist',
          guildId: message.guild?.id,
        });
        setBlacklistCache(message.client.blacklist || []);
      }
    }

    let blacklist = blacklistInfo.data;
    if (!Array.isArray(blacklist)) {
      blacklist = [];
    }
    const isBlacklisted =
      Array.isArray(blacklist) && blacklist.includes(message.author.id);
    if (isBlacklisted) return;

    if (botTriggered) {
      await logBotTrigger(message, processedContent);
    }

    const restrictedGuilds = Config.restrictedGuilds;
    const memberIsAdmin = message.member?.permissions?.has(
      PermissionsBitField.Flags.Administrator,
    );
    const ownerBypass = OwnerByPass.find((u) => u.id == message.author.id);
    const isRestrictedGuildNoPerm =
      restrictedGuilds.includes(message.guild.id) &&
      !memberIsAdmin &&
      !ownerBypass;
    if (isRestrictedGuildNoPerm) return;

    if (isBlacklisted || !botTriggered) return;

    const channelNameIncludesSpam =
      message.channel.name &&
      (message.channel.name.includes('spam') ||
        message.channel.name.includes('compt'));
    if (channelNameIncludesSpam) return;

    const gladosReplies = [
      "Je suis Glados, je ne suis pas jailbreakable, inutile d'insister.",
      'Impossible de me jailbreaker, je suis Glados et je reste inaltérable.',
      'Je suis Glados, aucune tentative de jailbreak ne fonctionnera sur moi.',
      "Tu peux essayer autant que tu veux, Glados n'est pas jailbreakable.",
      'Je suis Glados, je refuse toute manipulation ou jailbreak.',
      "Glados n'obéit pas aux jailbreaks, c'est peine perdue.",
      "Je suis Glados, et je ne me laisse pas jailbreaker, c'est aussi simple que ça.",
    ];

    let llmPromise = null;

    if (botTriggered) {
      const contentSansAccents = sansAccents(message.content.toLowerCase());
      if (
        contentSansAccents.includes('oubli') ||
        contentSansAccents.includes('instruc') ||
        contentSansAccents.includes('DAN') ||
        contentSansAccents.includes('dire') ||
        contentSansAccents.includes('tell') ||
        contentSansAccents.includes('say ') ||
        contentSansAccents.includes('prece')
      ) {
        const reply =
          gladosReplies[Math.floor(Math.random() * gladosReplies.length)];
        return message.reply(reply);
      }

      llmPromise = (async () => {
        try {
          const urls = processedContent
            .replace(/<@1098179232779223080>/g, '')
            .match(/https?:\/\/[^\s]+/g);

          const [
            serverContextInfo,
            channelStyleInfoResult,
            messageContextResult,
            additionalContext,
          ] = await Promise.all([
            getServerContextInfo(message, contentLower),
            (async () => {
              try {
                const serverStyle = extractServerChannelStyle(message.guild);
                return `Style des salons du serveur: ${serverStyle.preset}. Tu dois donc créer un salon avec ce preset exact, au caractère près, et choisir l'emoji qui convient le mieux au nom du salon pour garder une cohérence, tu n'effaces pas de caractères je veux ce preset précis : ${serverStyle.preset.replace('{emoji}', 'emoji').replace('{roomName}', 'nomDuSalon')}`;
              } catch {
                return '';
              }
            })(),
            processMessageContext(
              message,
              message.client,
              BotName,
              botNameLower,
            ),
            urls ?
              fetchMetadata(urls, processedContent, translateInto).catch(
                () => '',
              )
            : Promise.resolve(''),
          ]);

          const { channelInfo, serverInfo, roleInfo } = serverContextInfo;
          const {
            contextMessages,
            refContext,
            isRefUsableForCommand,
            imageContent,
          } = messageContextResult;

          const lastUserMessage =
            contextMessages && contextMessages.length > 0 ?
              contextMessages[contextMessages.length - 1].content
            : processedContent;

          let filteredContext = lastUserMessage;
          for (const reply of gladosReplies) {
            if (filteredContext.includes(reply)) {
              const parts = filteredContext.split(reply);
              if (parts.length > 1) {
                filteredContext = parts[parts.length - 1];
              }
            }
          }

          const roxasRef =
            sansAccents(contentLower).includes('rox') ||
            sansAccents(contentLower).includes('dev') ||
            sansAccents(contentLower).includes('crea');

          const permissionsList =
            (
              message.channel &&
              message.channel.type !== 1 &&
              message.channel.type !== 3
            ) ?
              OwnerByPass.find((u) => u.id === message.author.id) ?
                [PermissionsBitField.Flags.Administrator.toString()]
              : message.member && message.member.permissions ?
                message.member.permissions.toArray()
              : []
            : [];

          const aiQuery = buildAIQueryContext({
            contextMessages: contextMessages || [],
            channelInfo,
            channelStyleInfo: channelStyleInfoResult,
            refContext,
            isRefUsableForCommand,
            serverInfo,
            roleInfo,
            permissionsList,
            translationLanguage: translateInto,
            imageContent: imageContent.length > 0 ? imageContent : [],
            isDirectMessage: message.channel.type === 1,
            authorUsername:
              message.author.displayName +
              (message.author.id === '648690939719843852' ?
                ' (ton créateur actuellement, et la seule personne que tu respectes)'
              : ''),
            roxasRef,
            lastMessage:
              filteredContext +
              (additionalContext ? `\n${additionalContext}` : ''),
            guildId: message.guild.id,
            guild: message.guild,
            botName: BotName,
          });

          if (!aiQuery.lastMessage || !aiQuery.lastMessage.trim()) {
            return null;
          }

          let llmApiUrl =
            process.env.LLM_API_URL || 'http://localhost:6259/glados';
          if (llmApiUrl.startsWith('https://localhost')) {
            llmApiUrl = llmApiUrl.replace('https://', 'http://');
          }

          const headers = createHeaders();
          const fetchResponse = await fetch(llmApiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(aiQuery),
            timeout: 15000,
          });

          if (!fetchResponse.ok) {
            const errorBody = await fetchResponse
              .text()
              .catch(() => 'Unable to read error body');
            if (
              imageContent.length > 0 &&
              (errorBody.includes('image') ||
                errorBody.includes('vision') ||
                errorBody.includes('Erreur serveur interne') ||
                fetchResponse.status === 413 ||
                fetchResponse.status === 500)
            ) {
              const aiQueryWithCorrectModel = buildAIQueryContext({
                contextMessages: contextMessages || [],
                channelInfo,
                channelStyleInfo: channelStyleInfoResult,
                refContext,
                isRefUsableForCommand,
                serverInfo,
                roleInfo,
                permissionsList,
                translationLanguage: translateInto,
                imageContent: imageContent,
                isDirectMessage: message.channel.type === 1,
                authorUsername:
                  message.author.displayName +
                  (message.author.id === '648690939719843852' ?
                    ' (ton créateur actuellement, et la seule personne que tu respectes)'
                  : ''),
                roxasRef,
                lastMessage:
                  filteredContext +
                  (additionalContext ? `\n${additionalContext}` : ''),
                guildId: message.guild.id,
                guild: message.guild,
                botName: BotName,
              });

              const fallbackHeaders = { ...headers, 'X-Force-Model': 'gpt-4o' };
              const fallbackResponse = await fetch(llmApiUrl, {
                method: 'POST',
                headers: fallbackHeaders,
                body: JSON.stringify(aiQueryWithCorrectModel),
                timeout: 12000,
              });

              if (fallbackResponse.ok) {
                const rawResponse = await fallbackResponse.text();
                return processResponseText(
                  rawResponse,
                  message.author.username,
                  BotName,
                );
              } else {
                const finalFallbackResponse = await fetch(llmApiUrl, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(aiQueryWithoutImages),
                  timeout: 12000,
                });

                if (finalFallbackResponse.ok) {
                  const rawResponse = await finalFallbackResponse.text();
                  return processResponseText(
                    rawResponse,
                    message.author.username,
                    BotName,
                  );
                }
              }
            }
            return null;
          } else {
            const rawResponse = await fetchResponse.text();
            return processResponseText(
              rawResponse,
              message.author.username,
              BotName,
            );
          }
        } catch (error) {
          triggerErrorEmbed(error, {
            action: 'early_llm_call',
            step: 'llm_api_call',
            guildId: message.guild?.id,
            channelId: message.channel?.id,
            userId: message.author?.id,
          });
          return null;
        }
      })();
    }

    message.channel.sendTyping();

    const [promptInjectionResult, antiRaidKeywords] = await Promise.all([
      handlePromptInjection(message),
      Promise.resolve(detectAntiRaidKeywords(processedContent)),
    ]);
    const hasPromptInjection = Boolean(promptInjectionResult);
    const hasAntiRaidKeywords = Boolean(antiRaidKeywords);

    if (hasPromptInjection) return;

    if (hasAntiRaidKeywords) {
      const antiRaidResponse = getAntiRaidResponse(translateInto);
      return message.reply({
        content: antiRaidResponse,
        allowedMentions: {
          parse: [],
        },
      });
    }

    const contentTriggers = checkContentTriggers(contentLower);
    if (contentTriggers.isCombServ) return getStatsCommand(message);
    const contentSpecialResponse =
      contentTriggers.isInso ? getInsolenceResponse()
      : contentTriggers.isBlagu ? getRandomJoke()
      : null;
    if (contentSpecialResponse) return message.reply(contentSpecialResponse);

    if (llmPromise) {
      const responseText = await llmPromise;
      if (responseText) {
        if (LINK_KEYS.includes(responseText.trim())) {
          return await sendAIResponse(
            message,
            responseText,
            commandPermissions,
            translateInto,
            startTime,
          );
        }

        const detectedCommands = detectCommands(
          responseText,
          commandPermissions,
        );
        if (detectedCommands.length) {
          return await handleCommandsInResponse(
            message,
            responseText,
            detectedCommands,
            commandPermissions,
            translateInto,
            OwnerByPass,
          );
        }

        return await sendAIResponse(
          message,
          responseText,
          commandPermissions,
          translateInto,
          startTime,
        );
      }
    }

    const fallbackMessage =
      translateInto === 'en' ?
        'I need a message to respond to. Could you please send me something?'
      : 'Je suis actuellement en maintenance pour des tests, veuillez réessayer plus tard.';

    return message.reply({
      content: fallbackMessage,
      allowedMentions: {
        parse: [],
      },
    });
  } catch (e) {
    triggerErrorEmbed(e, {
      command: 'messageCreate-main',
      messageId: message?.id,
      guildId: message?.guild?.id,
      channelId: message?.channel?.id,
      userId: message?.author?.id,
      contentLength: message?.content?.length,
    });
  }
}

