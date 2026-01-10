import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import {
  isServerEmptyAfterRaid,
  removeAllBotPermissions,
} from './handleChannelCreateRaid.js';
import { deleteAllChannelsCreatedByBot } from './handleChannelDeleteRaid.js';
import { startServerRestoration } from './handleMassiveDeletion.js';
import { sendUniqueRaidReport } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

import {
  isBotWhitelisted,
  markBotAsMalicious,
  markComboRaidDetected,
  markGuildSecure,
  markGuildUnderAttack,
  recordBlockedAction,
} from './antiRaidCoordinator.js';

const COMBO_RAID_WINDOW = ANTI_RAID_CONFIG.MASS_DELETE.TIME_WINDOW * 2;
const MIN_ACTIONS_FOR_COMBO = 3;

async function handleComboRaid(guild, botId) {
  try {
    const guildId = guild.id;

    if (!botId || botId === 'undefined' || !/^\d{17,19}$/.test(botId)) {
      return {
        success: false,
        error: 'Invalid bot ID provided',
      };
    }

    if (await isBotWhitelisted(botId, guild.client)) {
      return {
        success: false,
        error: 'Verified bot exempted from combo raid protection',
      };
    }

    markComboRaidDetected(guildId, botId);
    markGuildUnderAttack(guildId, 'combo', botId);
    const permissionsRemoved = await removeAllBotPermissions(guild, botId);

    const deletedChannelsCount = await deleteAllChannelsCreatedByBot(
      guild,
      botId,
    );

    if (await isBotWhitelisted(botId, guild.client)) {
      return;
    }

    let botBanned = false;
    try {
      await guild.bans.create(botId, {
        reason:
          'Raid combo détecté - Suppression massive + Création - Protection GLaDOS',
      });
      botBanned = true;
      markBotAsMalicious(botId);
    } catch (banError) {
      if (banError.code === 10013) {
        markBotAsMalicious(botId);
      }
      recordBlockedAction(guildId, 'combo_raid_ban_failed', botId);
    }

    const needsRestoration = isServerEmptyAfterRaid(guild);

    if (needsRestoration) {
      await startServerRestoration(guild, botId);
    }

    setTimeout(() => {
      markGuildSecure(guildId);
    }, 3000);

    return {
      success: true,
      permissionsRemoved,
      channelsDeleted: deletedChannelsCount,
      botBanned,
      restorationTriggered: needsRestoration,
    };
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleComboRaid.js',
      action: 'handle_combo_raid',
      guildId: guild?.id,
      botId,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

async function sendComboRaidReports(guild, botId, results) {
  await sendUniqueRaidReport(
    guild,
    '🔴 RAID COMBO SOPHISTIQUÉ NEUTRALISÉ',
    {
      description:
        `**ATTAQUE COMBINÉE AVANCÉE DÉTECTÉE ET CONTRÉE**\n\n` +
        `**Bot Malveillant:** <@${botId}> (${botId})\n` +
        `**Type:** Suppression massive + Création de salons (Combo)\n` +
        `**Suppressions originales:** ${results.analysisResult.deletions.length}\n` +
        `**Salons créés supprimés:** ${results.channelsDeleted}\n\n` +
        `**Actions Exécutées:**\n` +
        `${results.permissionsRemoved ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'} Permissions bot retirées\n` +
        `<:true:1304519561814741063> ${results.channelsDeleted} salons malveillants supprimés\n` +
        `${results.botBanned ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'} Bot banni définitivement\n` +
        `${results.restorationTriggered ? '<:true:1304519561814741063>' : '❓'} Restauration serveur ${results.restorationTriggered ? 'déclenchée' : 'non nécessaire'}\n\n` +
        `**Temps de Neutralisation:** < 5 secondes\n` +
        `**Status:** 🔒 Menace complètement éliminée`,
      color: 0x8b0000,
    },
    'combo_raid_neutralized',
    botId,
  );
}

function detectComboRaidPattern(
  botId,
  recentDeletions = [],
  recentCreations = [],
) {
  const now = Date.now();

  const botDeletions = recentDeletions.filter(
    (deletion) =>
      deletion.deletorId === botId &&
      now - deletion.timestamp < COMBO_RAID_WINDOW,
  );

  const botCreations = recentCreations.filter(
    (creation) =>
      creation.creatorId === botId &&
      now - creation.timestamp < COMBO_RAID_WINDOW,
  );

  const hasEnoughDeletions = botDeletions.length >= MIN_ACTIONS_FOR_COMBO;
  const hasEnoughCreations = botCreations.length >= MIN_ACTIONS_FOR_COMBO;

  if (!hasEnoughDeletions || !hasEnoughCreations) {
    return false;
  }

  const avgDeletionTime =
    botDeletions.reduce((sum, d) => sum + d.timestamp, 0) / botDeletions.length;
  const avgCreationTime =
    botCreations.reduce((sum, c) => sum + c.timestamp, 0) / botCreations.length;

  const timingPattern =
    Math.abs(avgCreationTime - avgDeletionTime) < COMBO_RAID_WINDOW / 2;

  if (timingPattern) {
    return true;
  }

  return false;
}

function analyzeComboRaidDamage(guild, botId) {
  try {
    const now = Date.now();

    const totalChannels = guild.channels.cache.size;
    const textChannels = guild.channels.cache.filter((c) => c.type === 0).size;

    const estimatedDamagePercent =
      totalChannels > 0 ?
        Math.min(
          100,
          Math.round(((MIN_ACTIONS_FOR_COMBO * 2) / totalChannels) * 100),
        )
      : 0;

    return {
      botId,
      guildId: guild.id,
      totalChannelsRemaining: totalChannels,
      textChannelsRemaining: textChannels,
      estimatedDamagePercent,
      analysisTime: now,
      severity:
        estimatedDamagePercent > 50 ? 'critical'
        : estimatedDamagePercent > 25 ? 'high'
        : 'moderate',
    };
  } catch (error) {
    return {
      botId,
      guildId: guild.id,
      error: error.message,
      analysisTime: Date.now(),
      severity: 'unknown',
    };
  }
}

function createComboRaidPerformanceReport(guild, botId, startTime, results) {
  const endTime = Date.now();
  const totalTime = endTime - startTime;

  return {
    guildName: guild.name,
    guildId: guild.id,
    botId,
    performance: {
      totalNeutralizationTime: totalTime,
      permissionsRemovedTime: '< 1s',
      channelCleanupTime: '< 3s',
      banTime: '< 1s',
      restorationTime: results.restorationTriggered ? '< 5s' : 'N/A',
    },
    effectiveness: {
      permissionsRemoved: results.permissionsRemoved,
      channelsDeleted: results.channelsDeleted,
      botBanned: results.botBanned,
      serverRestored: results.restorationTriggered,
      successRate: calculateSuccessRate(results),
    },
    timestamp: endTime,
  };
}

function calculateSuccessRate(results) {
  let successCount = 0;
  let totalOperations = 0;

  totalOperations++;
  if (results.permissionsRemoved) successCount++;

  totalOperations++;
  if (results.channelsDeleted > 0) successCount++;

  totalOperations++;
  if (results.botBanned) successCount++;

  if (results.restorationTriggered !== undefined) {
    totalOperations++;
    if (results.restorationTriggered) successCount++;
  }

  return totalOperations > 0 ?
      Math.round((successCount / totalOperations) * 100)
    : 0;
}

export {
  analyzeComboRaidDamage,
  calculateSuccessRate,
  createComboRaidPerformanceReport,
  detectComboRaidPattern,
  handleComboRaid,
  sendComboRaidReports,
};

