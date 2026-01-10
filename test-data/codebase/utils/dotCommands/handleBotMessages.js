import {
  MessageType,
  PermissionsBitField,
  UserFlagsBitField,
} from 'discord.js';
import {
  handleMaliciousBotReturn,
  isAntiPubDisabled,
  isBotMalicious,
  isBotWhitelisted as isBotWhitelistedCoordinator,
  markBotForEnhancedMonitoring,
  recordSuspiciousActivity,
} from '../antiRaidCoordinator.js';
import { sendWarningEmbed } from '../discordUtils.js';
import { convertText } from '../fontConverter.js';
import { isWebhookProtectedFromDeletion } from '../handleWebhookRaid.js';
import {
  hasBanMembersPermission,
  hasManageMessagesPermission,
} from '../permissionsUtils.js';
import { isBotWhitelisted } from '../permissionUtils.js';
import triggerErrorEmbed from '../triggerErrorEmbed.js';
const botMessagesMap = new Map();

async function analyzeBotMessage(message) {
  try {
    if (!message.author.bot) return false;

    const botId = message.author.id;
    const guild = message.guild;

    if (!guild) return false;

    const returnAction = await handleMaliciousBotReturn(
      guild,
      botId,
      'message',
    );

    if (returnAction === 'rebanned') {
      return true;
    }

    const content = message.content?.toLowerCase() || '';
    const suspiciousPatterns = [
      'raid',
      'nuke',
      'destroy',
      'delete',
      'mass',
      'spam',
      'attack',
    ];

    const isSuspicious = suspiciousPatterns.some((pattern) =>
      content.includes(pattern),
    );

    if (isSuspicious) {
      recordSuspiciousActivity(guild.id, botId, 'suspicious_message', 1, true);
    }

    return isSuspicious;
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleBotMessages.js',
      action: 'analyze_bot_message',
      botId: message?.author?.id,
    });
    return false;
  }
}

async function handleBotMessage(message) {
  if (!message.author.bot) return;

  const isSuspicious = await analyzeBotMessage(message);

  if (isSuspicious) {
    markBotForEnhancedMonitoring(message.guild.id, message.author.id);
  }
}

async function handleBotMessages(m) {
  if (!m || !m.channel || !m.author || !m.guild) {
    return;
  }

  if (!m.channel.name || !m.channel.messages) {
    return;
  }

  if (!m.channel.id) {
    return;
  }

  const channelId = m.channel?.id || null;
  const guildId = m.guild?.id || null;
  const authorId = m.author?.id || null;
  if (!channelId || !guildId || !authorId) return;

  const isAntiPubCurrentlyDisabled = isAntiPubDisabled(guildId);
  if (isAntiPubCurrentlyDisabled) {
    return;
  }

  const name = convertText(m.channel.name, 'normal').toLowerCase();
  if (
    ['spam', 'count', 'compt', 'mudae'].some((w) =>
      convertText(name, 'normal').toLowerCase().includes(w),
    )
  )
    return;
  if (isBotWhitelisted(authorId)) return;

  let isVerified = false;
  try {
    const user = await m.client.users.fetch(authorId).catch(() => null);
    isVerified = user?.flags?.has(UserFlagsBitField.Flags.VerifiedBot);
  } catch {
    isVerified = false;
  }

  if (isVerified) {
    return;
  }

  if (m.author.bot) {
    if (m.webhookId) {
      try {
        const isProtected = await isWebhookProtectedFromDeletion(
          m.guild,
          m.webhookId,
        );
        if (isProtected) {
          return;
        }
      } catch {
        return;
      }
    }
  }
  const id = authorId,
    isBot = m.author.bot,
    limit = isBot ? 5 : 7,
    now = Date.now();
  if (!botMessagesMap.has(id)) botMessagesMap.set(id, []);
  const arr = botMessagesMap.get(id);
  arr.push(now);
  if (arr.length >= limit - 1 && now - arr[arr.length - limit] < 5000) {
    try {
      if (!hasManageMessagesPermission(m.channel)) {
        return;
      }
      const channelExists = await m.client.channels
        .fetch(channelId)
        .catch(() => null);
      if (!channelExists || !channelExists.messages) {
        return;
      }
      const msgs = (
        await channelExists.messages.fetch({
          limit: 15,
        })
      ).filter((x) => x.author && x.author.id == id);
      botMessagesMap.set(id, []);
      const recentMsgs = msgs.filter(
        (msg) => Date.now() - msg.createdTimestamp < 1209600000,
      );

      if (authorId === id && !recentMsgs.has(m.id)) {
        recentMsgs.set(m.id, m);
      }
      if (recentMsgs.size > 0) {
        const messagesToDelete = [];
        for (const msg of recentMsgs.values()) {
          if (msg.webhookId) {
            try {
              const isProtected = await isWebhookProtectedFromDeletion(
                m.guild,
                msg.webhookId,
              );
              if (!isProtected) {
                messagesToDelete.push(msg);
              }
            } catch (error) {
              console.error(
                'Erreur lors de la vérification du webhook protégé:',
                error,
              );
            }
          } else {
            messagesToDelete.push(msg);
          }
        }
        if (messagesToDelete.length > 0) {
          try {
            await channelExists.bulkDelete(messagesToDelete);
          } catch (bulkDeleteError) {
            console.log(
              'BulkDelete failed:',
              bulkDeleteError.message,
              'trying individual deletion...',
            );
            for (const msg of messagesToDelete) {
              try {
                await msg.delete();
              } catch (individualDeleteError) {
                if (![10008, 50013].includes(individualDeleteError.code)) {
                  console.error(
                    'Error deleting individual message:',
                    individualDeleteError,
                  );
                }
              }
            }
          }

          try {
            const triggerMessageExists = await channelExists.messages
              .fetch(m.id)
              .catch(() => null);
            if (triggerMessageExists) {
              await triggerMessageExists.delete();
            }
          } catch (finalDeleteError) {
            if (![10008, 50013].includes(finalDeleteError.code)) {
              console.error(
                'Error deleting trigger message:',
                finalDeleteError,
              );
            }
          }
        }
      }
      if (isBot) {
        if (hasBanMembersPermission(m.guild)) {
          const member = await m.guild.members.fetch(id).catch(() => null);
          if (member) {
            if (await isBotWhitelistedCoordinator(id, m.client)) {
              console.log(
                `✅ Bot vérifié Discord ignoré par handleBotMessages (spam): ${id}`,
              );
              return;
            }

            if (isBotMalicious(id)) {
              console.log(
                `[UltraAntiRaid] Bot ${id} déjà marqué malveillant (raid ultra-rapide) - pas de ban supplémentaire`,
              );
              return;
            }

            await m.channel.guild.bans
              .create(id, {
                reason: 'Raid de spam de message massif détecté',
              })
              .catch(() => {});

            try {
              const auditLogs = await m.guild.fetchAuditLogs({
                type: 10,
                limit: 50,
              });
              const now = Date.now();
              const channelsToDelete = auditLogs.entries
                .filter(
                  (e) =>
                    e.executorId === id && now - e.createdTimestamp < 60000,
                )
                .map((e) => m.guild.channels.cache.get(e.target.id))
                .filter(Boolean);
              if (channelsToDelete.length > 0) {
                console.log(
                  `[UltraAntiRaid] Suppression post-ban de ${channelsToDelete.length} salons créés par le bot spammeur ${id}...`,
                );
                await Promise.allSettled(
                  channelsToDelete.map((ch) =>
                    ch
                      .delete(
                        'Suppression post-ban bot spammeur (cross-check logs)',
                      )
                      .then(() => {
                        console.log(
                          `[UltraAntiRaid] Salon ${ch.id} supprimé post-ban.`,
                        );
                      })
                      .catch((err) => {
                        console.error(
                          `[UltraAntiRaid] Échec suppression post-ban salon ${ch.id}:`,
                          err,
                        );
                      }),
                  ),
                );
              }
            } catch (err) {
              console.error(
                '[UltraAntiRaid] Erreur lors du cross-check suppression post-ban (spam):',
                err,
              );
            }
          }
        }
      } else {
        await (
          await m.guild.members.fetch(id)
        ).timeout(5 * 60 * 1000, 'Spam de messages détecté');
      }
    } catch (e) {
      if (
        ![50013, 50001, 10003, 10008, 50034, 'ChannelNotCached'].includes(
          e.code,
        )
      ) {
        triggerErrorEmbed(
          e,
          m.client?.user?.username,
          m.client?.user?.displayAvatarURL(),
        );
      }
    }
    try {
      const channelStillExists = await m.client.channels
        .fetch(channelId)
        .catch(() => null);
      if (!channelStillExists || !channelStillExists.messages) {
        return;
      }
      const botEmbeds = (
        await channelStillExists.messages.fetch({
          limit: 10,
        })
      ).filter(
        (x) =>
          x.author && x.author.id == m.client.user.id && x.embeds.length > 0,
      );
      if (!botEmbeds.size) {
        const type = isBot ? 'Anti-Raid' : 'Anti-Spam';
        const desc = `> <a:warning:1269193959503040553> Un ${isBot ? 'bot de raid' : 'membre'} a **spammé les messages**.\n> <a:interdit:1269193896790065152> Je les ai **automatiquement supprimés**${!isBot ? ' et **mute ce membre pendant 5 minutes**' : ''} .\n> <a:valider:1298662697185050634> Ne me remerciez pas, je ne fais que ce que je peux pour **garder ce serveur sûr.**`;
        if (channelStillExists && channelStillExists.send) {
          await sendWarningEmbed(channelStillExists, desc, type);
        }
      }
    } catch (fetchError) {
      if (fetchError.code !== 'ChannelNotCached' && fetchError.code !== 10008) {
        triggerErrorEmbed(
          fetchError,
          m.client?.user?.username,
          m.client?.user?.displayAvatarURL(),
        );
      }
    }
  }

  if (m.type === MessageType.ChannelFollowAdd || m.system) {
    return;
  }

  const isOnlyMember =
    m.member ?
      !m.member.permissions?.has(PermissionsBitField.Flags.ModerateMembers) &&
      !m.author.bot
    : !m.author.bot;
  const isInviteLink =
    m.content.includes('discord.gg') ||
    m.content.includes('discord.com/invite') ||
    m.content.includes('discordapp.com/invite');
  const isEveryoneOrHereMention =
    m.content.includes('@everyone') || m.content.includes('@here');
  if (
    (isOnlyMember && isInviteLink) ||
    (isBot &&
      (isInviteLink || isEveryoneOrHereMention) &&
      authorId !== m.client.user.id &&
      (!m.member ||
        !m.member.permissions?.has(PermissionsBitField.Flags.ModerateMembers)))
  ) {
    if (isAntiPubDisabled(guildId)) {
      return;
    }

    const channelName =
      m.channel && m.channel.name ?
        convertText(m.channel.name, 'normal').toLowerCase()
      : '';
    const isPubPromoChannel = ['pub', 'promo', 'part'].some((w) =>
      channelName.includes(w),
    );

    if (isPubPromoChannel) {
      return;
    } else {
      try {
        if (
          !m.guild.members.me.permissions.has(
            PermissionsBitField.Flags.ManageMessages,
          )
        ) {
          return;
        }

        if (!m.channel || !m.channel.messages) {
          return;
        }

        const messageExists = await m.channel.messages
          .fetch(m.id)
          .catch(() => null);
        if (messageExists) {
          const desc = `> <a:warning:1269193959503040553> **Une invitation Discord a été détectée**.\n> <a:interdit:1269193896790065152> Ce message a été **automatiquement supprimé**.\n> <a:valider:1298662697185050634> Merci de **respecter les règles** du serveur concernant les invitations.`;
          const sentMsg = await sendWarningEmbed(m.channel, desc, 'Anti-Pub');
          if (sentMsg && sentMsg.deletable)
            setTimeout(() => sentMsg.delete().catch(() => {}), 8000);
          await m.delete();
        }
      } catch (error) {
        if (![10008, 50013, 50001].includes(error.code)) {
          triggerErrorEmbed(
            error,
            m.client?.user?.username,
            m.client?.user?.displayAvatarURL(),
          );
        }
      }
    }
    try {
      if (!m.channel || typeof m.channel.fetchWebhooks !== 'function') {
        return;
      }

      const webhooks = await m.channel.fetchWebhooks();
      if (webhooks?.size > 0) {
        await Promise.all(
          webhooks.map(async (webhook) => {
            try {
              const isProtected = await isWebhookProtectedFromDeletion(
                m.guild,
                webhook.id,
              );

              if (!isProtected) {
                await webhook.delete(
                  'GLaDOS: Webhook supprimé pour détection de lien/pub non autorisé',
                );
              }
            } catch (deleteError) {
              if (![10015, 50013, 50001].includes(deleteError.code)) {
                console.error(
                  `Erreur suppression webhook ${webhook.id}:`,
                  deleteError.message,
                );
              }
            }
          }),
        );
      }
    } catch (webhookError) {
      if (
        !['ChannelNotCached', 10008, 50013, 50001].includes(webhookError.code)
      ) {
        triggerErrorEmbed(
          webhookError,
          m.client?.user?.username,
          m.client?.user?.displayAvatarURL(),
        );
      }
    }
  }
}

export { analyzeBotMessage, handleBotMessage, handleBotMessages };

