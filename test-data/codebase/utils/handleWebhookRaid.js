import { AuditLogEvent, UserFlagsBitField } from 'discord.js';
import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import { hasManageWebhooksPermission } from './permissionsUtils.js';

import {
  handleMaliciousBotReturn,
  isBotWhitelisted,
  markBotAsMalicious,
  markGuildSecure,
  markGuildUnderAttack,
  recordBlockedAction,
  recordSuspiciousActivity,
} from './antiRaidCoordinator.js';

import whitelist from '../whitelist.json' with { type: 'json' };
import { sendUniqueRaidReport } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const MASS_WEBHOOK_THRESHOLD = ANTI_RAID_CONFIG.MASS_CREATE?.THRESHOLD || 5;
const TIME_WINDOW = ANTI_RAID_CONFIG.MASS_CREATE?.TIME_WINDOW || 60000;

let botCache = new Map();

async function handleWebhookCreateRaid(webhook) {
  try {
    if (!webhook || !webhook.guild || !webhook.guild.available) {
      return;
    }

    if (!hasManageWebhooksPermission(webhook.guild)) {
      return;
    }

    const guildId = webhook.guild.id;

    const auditLogs = await webhook.guild.fetchAuditLogs({
      limit: 5,
      type: AuditLogEvent.WebhookCreate,
    });

    const creationEntry = auditLogs.entries.first();
    const creatorId = creationEntry?.executor?.id;

    if (!creatorId || whitelist.WhitelistedBots.includes(creatorId)) {
      return;
    }
    const user = creationEntry?.executor;
    const isVerifiedBot =
      user?.flags?.has(UserFlagsBitField.Flags.VerifiedBot) || false;

    if (isVerifiedBot) {
      return;
    }

    if (await isBotWhitelisted(creatorId, webhook.guild.client)) {
      return;
    }

    if (
      await isWebhookProtectedFromDeletion(webhook.guild, webhook.id, creatorId)
    ) {
      return;
    }

    const botCacheKey = `${creatorId}_isbot`;
    let isBot = botCache?.get(botCacheKey);

    if (isBot === undefined) {
      isBot = await isUserBot(webhook.guild, creatorId);
      if (!botCache) botCache = new Map();
      botCache.set(botCacheKey, isBot);
      setTimeout(() => botCache.delete(botCacheKey), 30000);
    }

    const recentWebhooks = await analyzeRecentWebhookCreations(
      webhook.guild,
      creatorId,
    );

    if (recentWebhooks.length >= MASS_WEBHOOK_THRESHOLD) {
      if (!isBot) {
        recordBlockedAction(guildId, 'webhook_create_human', creatorId, false);
        return;
      }

      const returnAction = await handleMaliciousBotReturn(
        webhook.guild,
        creatorId,
        'attack',
      );
      if (returnAction === 'rebanned') {
        return;
      } else if (returnAction === 'reset_data') {
        await triggerEmergencyWebhookProtection(webhook.guild, creatorId);
        return;
      }

      markGuildUnderAttack(guildId, 'mass_webhook_create', creatorId);

      const deletedWebhooks = await deleteAllWebhooksCreatedByBot(
        webhook.guild,
        creatorId,
      );

      await banMaliciousBotWebhook(webhook.guild, creatorId, deletedWebhooks);

      setTimeout(() => {
        markGuildSecure(guildId);
      }, 5000);
    } else {
      recordSuspiciousActivity(
        guildId,
        creatorId,
        'webhook_creation',
        1,
        isBot,
      );
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleWebhookRaid.js',
      action: 'webhook_create_detection',
      guildId: webhook?.guild?.id,
    });
  }
}

async function handleWebhookDeleteRaid(webhook) {
  try {
    if (!webhook || !webhook.guild || !webhook.guild.available) {
      return;
    }
    if (!hasManageWebhooksPermission(webhook.guild)) {
      return;
    }

    const guildId = webhook.guild.id;

    const auditLogs = await webhook.guild.fetchAuditLogs({
      limit: 5,
      type: AuditLogEvent.WebhookDelete,
    });

    const deletionEntry = auditLogs.entries.first();
    const deletorId = deletionEntry?.executor?.id;

    if (!deletorId || whitelist.WhitelistedBots.includes(deletorId)) {
      return;
    }

    const user = deletionEntry?.executor;
    const isVerifiedBot =
      user?.flags?.has(UserFlagsBitField.Flags.VerifiedBot) || false;

    if (isVerifiedBot) {
      return;
    }

    if (await isBotWhitelisted(deletorId, webhook.guild.client)) {
      return;
    }

    const recentDeletions = await analyzeRecentWebhookDeletions(
      webhook.guild,
      deletorId,
    );

    if (recentDeletions.length >= MASS_WEBHOOK_THRESHOLD) {
      const isBot = await isUserBot(webhook.guild, deletorId);

      if (!isBot) {
        recordBlockedAction(guildId, 'webhook_delete_human', deletorId, false);
        return;
      }

      markGuildUnderAttack(guildId, 'mass_webhook_delete', deletorId);

      await banMaliciousBotWebhook(webhook.guild, deletorId, 0, 'suppression');

      setTimeout(() => {
        markGuildSecure(guildId);
      }, 5000);
    } else {
      const isBot = await isUserBot(webhook.guild, deletorId);
      recordSuspiciousActivity(
        guildId,
        deletorId,
        'webhook_deletion',
        1,
        isBot,
      );
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleWebhookRaid.js',
      action: 'webhook_delete_detection',
      guildId: webhook?.guild?.id,
    });
  }
}

async function analyzeRecentWebhookCreations(guild, userId) {
  try {
    const now = Date.now();
    const auditLogs = await guild.fetchAuditLogs({
      limit: 50,
      type: AuditLogEvent.WebhookCreate,
    });

    const recentCreations = [];

    for (const entry of auditLogs.entries.values()) {
      const timeDiff = now - entry.createdTimestamp;

      if (timeDiff < TIME_WINDOW && entry.executor?.id === userId) {
        recentCreations.push({
          webhookId: entry.target?.id,
          webhookName: entry.target?.name,
          channelId: entry.target?.channelId,
          timestamp: entry.createdTimestamp,
          creatorId: entry.executor.id,
        });
      }
    }
    return recentCreations;
  } catch {
    return [];
  }
}

async function analyzeRecentWebhookDeletions(guild, userId) {
  try {
    const now = Date.now();
    const auditLogs = await guild.fetchAuditLogs({
      limit: 50,
      type: AuditLogEvent.WebhookDelete,
    });

    const recentDeletions = [];

    for (const entry of auditLogs.entries.values()) {
      const timeDiff = now - entry.createdTimestamp;

      if (timeDiff < TIME_WINDOW && entry.executor?.id === userId) {
        recentDeletions.push({
          webhookId: entry.target?.id,
          webhookName: entry.target?.name,
          channelId: entry.target?.channelId,
          timestamp: entry.createdTimestamp,
          deletorId: entry.executor.id,
        });
      }
    }
    return recentDeletions;
  } catch {
    return [];
  }
}

async function deleteAllWebhooksCreatedByBot(guild, botId) {
  if (
    (await isBotWhitelisted(botId, guild.client)) ||
    botId === guild.client.user.id
  ) {
    return 0;
  }

  try {
    const now = Date.now();
    let deletedCount = 0;

    const auditLogs = await guild.fetchAuditLogs({
      limit: 100,
      type: AuditLogEvent.WebhookCreate,
    });

    const webhooksToDelete = new Set();
    for (const entry of auditLogs.entries.values()) {
      if (
        entry.executor?.id === botId &&
        now - entry.createdTimestamp < TIME_WINDOW * 5
      ) {
        const webhookId = entry.target?.id;
        const channelId = entry.target?.channelId;
        const creator = entry.executor;

        if (
          creator.flags?.has(UserFlagsBitField.Flags.VerifiedBot) ||
          whitelist.WhitelistedBots.includes(creator.id) ||
          (await isBotWhitelisted(creator.id, guild.client))
        ) {
          continue;
        }

        if (webhookId && channelId) {
          webhooksToDelete.add({
            webhookId,
            channelId,
            name: entry.target?.name,
            creatorId: creator.id,
          });
        }
      }
    }
    const deletionPromises = Array.from(webhooksToDelete).map(
      async ({ webhookId, channelId, name, creatorId }) => {
        try {
          const channel = guild.channels.cache.get(channelId);
          if (!channel) {
            return {
              success: false,
              webhookId,
              error: 'Canal non trouvé',
            };
          }

          const webhooks = await channel.fetchWebhooks();
          const webhook = webhooks.get(webhookId);

          if (webhook && webhook.owner === null) {
            return {
              success: false,
              webhookId,
              name,
              error: 'Webhook système Discord (annonces) ignoré',
            };
          }

          if (!webhook) {
            return {
              success: true,
              webhookId,
              name,
              alreadyDeleted: true,
            };
          }

          if (
            creatorId &&
            (await isWebhookProtectedFromDeletion(guild, webhookId, creatorId))
          ) {
            return {
              success: false,
              webhookId,
              name,
              error:
                'Webhook créé par bot whitelisté/vérifié - suppression annulée',
            };
          }

          if (
            !creatorId &&
            (await isWebhookProtectedFromDeletion(guild, webhookId))
          ) {
            return {
              success: false,
              webhookId,
              name,
              error: 'Webhook protégé - suppression annulée par sécurité',
            };
          }

          await webhook.delete(
            `Webhook créé par bot malveillant ${botId} - GLaDOS Protection`,
          );
          deletedCount++;

          return {
            success: true,
            webhookId,
            name,
          };
        } catch (deleteError) {
          if (deleteError.code === 10015) {
            return {
              success: true,
              webhookId,
              name,
              alreadyDeleted: true,
            };
          }

          return {
            success: false,
            webhookId,
            error: deleteError.message,
          };
        }
      },
    );

    await Promise.allSettled(deletionPromises);
    return deletedCount;
  } catch {
    return 0;
  }
}

async function banMaliciousBotWebhook(
  guild,
  botId,
  deletedWebhooks = 0,
  raidType = 'création',
) {
  if (
    (await isBotWhitelisted(botId, guild.client)) ||
    botId === guild.client.user.id
  ) {
    return false;
  }

  try {
    if (!botId || botId === 'undefined' || !/^\d{17,19}$/.test(botId)) {
      return false;
    }

    const isBot = await isUserBot(guild, botId);
    if (!isBot) {
      return false;
    }

    if (await isBotWhitelisted(botId, guild.client)) {
      return false;
    }

    let banSuccess = false;
    try {
      const reason =
        raidType === 'suppression' ?
          'GLaDOS: Suppression massive de webhooks - Bannissement immédiat'
        : 'GLaDOS: Création massive de webhooks - Bannissement immédiat';

      await guild.bans.create(botId, {
        reason,
      });
      banSuccess = true;
      markBotAsMalicious(botId);
    } catch (banError) {
      if (ANTI_RAID_CONFIG.DEBUG?.ENABLED) {
        console.error(
          `Erreur bannissement webhook ${raidType}:`,
          banError.message,
        );
      }
    }

    setImmediate(async () => {
      try {
        const title =
          raidType === 'suppression' ?
            '🗑️ RAID DE SUPPRESSION MASSIVE DE WEBHOOKS CONTRÉ'
          : '🔗 RAID DE CRÉATION MASSIVE DE WEBHOOKS CONTRÉ';

        const actionText =
          raidType === 'suppression' ?
            'Suppression massive de webhooks'
          : 'Création massive de webhooks';

        const webhookText =
          raidType === 'suppression' ?
            `**Webhooks supprimés:** Nombreux webhooks supprimés`
          : `**Webhooks supprimés:** ${deletedWebhooks}`;

        await sendUniqueRaidReport(
          guild,
          title,
          {
            description:
              `**ATTAQUE DE ${actionText.toUpperCase()} DÉTECTÉE**\n\n` +
              `**Bot Malveillant:** <@${botId}> (${botId})\n` +
              `**Type:** ${actionText}\n` +
              `${webhookText}\n` +
              `**Actions Prises:**\n` +
              `<:true:1180540823557918812> ${banSuccess ? 'Bot banni immédiatement' : 'Tentative bannissement'}\n` +
              `<:true:1180540823557918812> Protection webhook activée\n` +
              `<:true:1180540823557918812> Surveillance renforcée activée\n\n` +
              `**Status:** ${banSuccess ? '🟢 Bot neutralisé' : '🟠 Neutralisation en cours...'}`,
            color: banSuccess ? 0x00ff00 : 0xff4444,
          },
          `mass_webhook_${raidType}_detection`,
          botId,
        );
      } catch (reportError) {
        console.error(
          `Erreur envoi rapport RAID WEBHOOK ${raidType.toUpperCase()} pour le bot ${botId}:`,
          reportError.message,
        );
      }
    });
    return banSuccess;
  } catch {
    return false;
  }
}

async function triggerEmergencyWebhookProtection(guild, suspiciousBotId) {
  try {
    markGuildUnderAttack(guild.id, 'critical_webhook', suspiciousBotId);
    markBotAsMalicious(suspiciousBotId, true, true);

    const deletedWebhooks = await deleteAllWebhooksCreatedByBot(
      guild,
      suspiciousBotId,
    );

    await banMaliciousBotWebhook(guild, suspiciousBotId, deletedWebhooks);

    setTimeout(() => {
      markGuildSecure(guild.id);
    }, 3000);
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleWebhookRaid.js',
      action: 'trigger_emergency_webhook_protection',
      guildId: guild?.id,
    });
  }
}

async function isUserBot(guild, userId) {
  try {
    const member = guild.members.cache.get(userId);
    if (member) {
      return member.user.bot;
    }

    const fetchedMember = await guild.members.fetch(userId).catch(() => null);
    if (fetchedMember) {
      return fetchedMember.user.bot;
    }

    const user = await guild.client.users.fetch(userId).catch(() => null);
    return user ? user.bot : false;
  } catch {
    return false;
  }
}

async function isWebhookProtectedFromDeletion(
  guild,
  webhookId,
  creatorId = null,
) {
  try {
    let actualCreatorId = creatorId;

    if (!actualCreatorId) {
      const auditLogs = await guild.fetchAuditLogs({
        limit: 100,
        type: AuditLogEvent.WebhookCreate,
      });

      const creationEntry = auditLogs.entries.find(
        (entry) => entry.target?.id === webhookId,
      );
      if (!creationEntry || !creationEntry.executor) {
        return false;
      }

      actualCreatorId = creationEntry.executor.id;
      const creator = creationEntry.executor;

      if (creator.flags?.has(UserFlagsBitField.Flags.VerifiedBot)) {
        return true;
      }
    }

    if (whitelist.WhitelistedBots.includes(actualCreatorId)) {
      return true;
    }

    if (await isBotWhitelisted(actualCreatorId, guild.client)) {
      return true;
    }

    if (actualCreatorId === guild.client.user.id) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export {
  analyzeRecentWebhookCreations,
  analyzeRecentWebhookDeletions,
  banMaliciousBotWebhook,
  deleteAllWebhooksCreatedByBot,
  handleWebhookCreateRaid,
  handleWebhookDeleteRaid,
  isUserBot,
  isWebhookProtectedFromDeletion,
  MASS_WEBHOOK_THRESHOLD,
  TIME_WINDOW,
  triggerEmergencyWebhookProtection,
};

