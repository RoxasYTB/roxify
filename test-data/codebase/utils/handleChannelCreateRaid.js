import {
  AuditLogEvent,
  EmbedBuilder,
  PermissionsBitField,
  UserFlagsBitField,
} from 'discord.js';
import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import whitelist from '../whitelist.json' with { type: 'json' };
import { hasManageChannelsPermission } from './permissionsUtils.js';
import { sendUniqueRaidReport } from './raidReportManager.js';

import {
  getAllChannelsCreatedByBot,
  getComboRaidState,
  handleMaliciousBotReturn,
  isAntiNukeCreationInProgress,
  isBotMalicious,
  isBotWhitelisted,
  isComboRaidInProgress,
  lockAntiNukeCreation,
  markBotAsMalicious,
  markGuildUnderAttack,
  recordChannelCreationByBot,
  recordSuspiciousActivity,
  setAntiPubDisabled,
  unlockAntiNukeCreation,
  updateComboRaidState,
} from './antiRaidCoordinator.js';

import { embedColor } from '../config/config.js';
import {
  recordDetectionMetric,
  recordNeutralizationMetric,
} from './antiRaidPerformanceMonitor.js';
import { startServerRestoration } from './handleChannelDeleteRaid.js';
import { isBotTrusted } from './permissionUtils.js';
import { markGuildAsProcessingChannelRaid } from './raidPriorityManager.js';
import { hasReportBeenSentRecently } from './raidReportManager.js';
import {
  instantChannelCreateDetection,
  scheduleDelayedChannelCleanup,
  ULTRA_FAST_THRESHOLDS,
} from './ultraFastRaidDetection.js';

async function isWhitelisted(userId, client = null) {
  if (
    whitelist.WhitelistedBots.includes(userId) ||
    whitelist.OwnerByPass.includes(userId)
  ) {
    return true;
  }

  if (await isBotWhitelisted(userId, client)) {
    return true;
  }

  return await isBotTrusted(userId, client);
}

let raidDetectionCache = new Map();

const RAID_THRESHOLD = ANTI_RAID_CONFIG.MASS_CREATE.THRESHOLD;
const TIME_WINDOW = ANTI_RAID_CONFIG.MASS_CREATE.TIME_WINDOW;

async function removeAllBotPermissions(guild, botId) {
  const startTime = process.hrtime.bigint();

  try {
    const member = await guild.members.fetch(botId).catch(() => null);
    if (!member) return false;

    const criticalPermissions = [
      PermissionsBitField.Flags.Administrator,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.BanMembers,
      PermissionsBitField.Flags.KickMembers,
    ];

    const criticalRoles = member.roles.cache.filter((role) => {
      if (role.id === guild.id) return false;
      return criticalPermissions.some((perm) => role.permissions.has(perm));
    });

    const roleRemovalPromises = criticalRoles.map((role) =>
      member.roles
        .remove(role, 'GLaDOS Ultra-Fast: Retrait permissions bot malveillant')
        .then(() => true)
        .catch(() => false),
    );

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Timeout permissions')),
        ANTI_RAID_CONFIG.EMERGENCY.IMMEDIATE_BAN_TIMEOUT,
      ),
    );

    const permissionsResult = await Promise.race([
      Promise.allSettled(roleRemovalPromises),
      timeoutPromise,
    ]).catch(() => []);

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000;

    const successfulRemovals =
      Array.isArray(permissionsResult) ?
        permissionsResult.filter(
          (r) => r.status === 'fulfilled' && r.value === true,
        ).length
      : 0;

    return (
      successfulRemovals > 0 || duration < ULTRA_FAST_THRESHOLDS.DETECTION_TIME
    );
  } catch {
    process.hrtime.bigint();

    return false;
  }
}

function isServerEmptyAfterRaid(guild) {
  const usableChannels = guild.channels.cache.filter(
    (c) => ![15, 4].includes(c.type),
  );

  const minChannels = Math.max(
    5,
    guild.features?.includes('COMMUNITY') ? 2 : 1,
  );

  return usableChannels.size <= minChannels;
}

async function deleteAllChannelsCreatedByMaliciousBot(guild, botId) {
  if (
    (await isBotWhitelisted(botId, guild.client)) ||
    botId === guild.client.user.id
  ) {
    return {
      channelsDeleted: 0,
      channelsFound: 0,
      errors: [
        'Bot vérifié, whitelisté ou self-bot, aucune suppression effectuée',
      ],
      methods: {
        auditLogs: 0,
        coordinatorCache: 0,
        patternMatching: 0,
      },
      timing: {
        detection: 0,
        deletion: 0,
        total: 0,
      },
    };
  }

  try {
    const member = await guild.members.fetch(botId).catch(() => null);
    if (member && member.user.flags?.has(UserFlagsBitField.Flags.VerifiedBot)) {
      return {
        channelsDeleted: 0,
        channelsFound: 0,
        errors: ['Bot vérifié Discord détecté - aucune suppression'],
        methods: {
          auditLogs: 0,
          coordinatorCache: 0,
          patternMatching: 0,
        },
        timing: {
          detection: 0,
          deletion: 0,
          total: 0,
        },
      };
    }
  } catch {
    return {
      channelsDeleted: 0,
      channelsFound: 0,
      errors: [
        'Impossible de vérifier le statut du bot - suppression annulée par sécurité',
      ],
      methods: {
        auditLogs: 0,
        coordinatorCache: 0,
        patternMatching: 0,
      },
      timing: {
        detection: 0,
        deletion: 0,
        total: 0,
      },
    };
  }

  const startTime = process.hrtime.bigint();
  const result = {
    channelsDeleted: 0,
    channelsFound: 0,
    errors: [],
    methods: {
      auditLogs: 0,
      coordinatorCache: 0,
      patternMatching: 0,
    },
    timing: {
      detection: 0,
      deletion: 0,
      total: 0,
    },
  };

  try {
    const channelsToDelete = new Map();
    const detectionStartTime = process.hrtime.bigint();

    try {
      await guild.channels.fetch();
    } catch (fetchError) {
      result.errors.push(`Erreur fetch canaux: ${fetchError.message}`);
    }

    try {
      const centralChannels = getAllChannelsCreatedByBot(guild.id, botId);

      for (const channelData of centralChannels) {
        const channel = guild.channels.cache.get(channelData.channelId);
        if (channel) {
          channelsToDelete.set(channelData.channelId, {
            channel,
            source: 'coordinator_cache',
            createdAt: channelData.timestamp,
            priority: 1,
          });
          result.methods.coordinatorCache++;
        }
      }
    } catch (coordinatorError) {
      result.errors.push(`Cache coordinateur: ${coordinatorError.message}`);
    }

    try {
      const suspiciousPatterns = [
        /^(raid|spam|hack|nuke|delete|destroy)/i,
        /^(bot|test|temp|temporary)/i,
        /[0-9]{10,}/,
        /^[\w\-_]+\d{3,}$/i,
        /^(general|chat|random|test)\d+$/i,
      ];
      const now = Date.now();
      const recentChannels = guild.channels.cache.filter((channel) => {
        if (channel.type !== 0) return false;
        if (now - channel.createdTimestamp > TIME_WINDOW * 5) return false;
        return suspiciousPatterns.some((pattern) => pattern.test(channel.name));
      });

      for (const channel of recentChannels.values()) {
        if (!channelsToDelete.has(channel.id)) {
          channelsToDelete.set(channel.id, {
            channel,
            source: 'pattern_matching',
            createdAt: channel.createdTimestamp,
            priority: 2,
          });
          result.methods.patternMatching++;
        }
      }
    } catch (patternError) {
      result.errors.push(`Pattern matching: ${patternError.message}`);
    }
    const auditPromise = guild
      .fetchAuditLogs({
        limit: 50,
        type: AuditLogEvent.ChannelCreate,
      })
      .then((auditLogs) => {
        const now = Date.now();
        for (const entry of auditLogs.entries.values()) {
          if (
            entry.executor?.id === botId &&
            now - entry.createdTimestamp < TIME_WINDOW * 3
          ) {
            const channelId = entry.target?.id;
            const channel = guild.channels.cache.get(channelId);

            if (channel && !channelsToDelete.has(channelId)) {
              if (
                !entry.executor?.flags?.has(UserFlagsBitField.Flags.VerifiedBot)
              ) {
                channelsToDelete.set(channelId, {
                  channel,
                  source: 'audit_logs',
                  createdAt: entry.createdTimestamp,
                  priority: 3,
                });
                result.methods.auditLogs++;
              }
            }
          }
        }
      })
      .catch((auditError) => {
        result.errors.push(`Audit logs: ${auditError.message}`);
      });

    await Promise.race([
      auditPromise,
      new Promise((resolve) =>
        setTimeout(resolve, ULTRA_FAST_THRESHOLDS.DETECTION_TIME),
      ),
    ]);

    const detectionEndTime = process.hrtime.bigint();
    result.timing.detection =
      Number(detectionEndTime - detectionStartTime) / 1000000;

    result.channelsFound = channelsToDelete.size;

    if (channelsToDelete.size > 0) {
      const deletionStartTime = process.hrtime.bigint();
      const sortedChannels = Array.from(channelsToDelete.values()).sort(
        (a, b) => a.priority - b.priority,
      );
      const deletionPromises = sortedChannels.map(
        async ({ channel, source }) => {
          try {
            const freshChannel = guild.channels.cache.get(channel.id);
            if (!freshChannel) {
              return {
                success: true,
                channelId: channel.id,
                source,
                alreadyDeleted: true,
              };
            }

            try {
              const channelAuditLogs = await guild.fetchAuditLogs({
                limit: 10,
                type: AuditLogEvent.ChannelCreate,
              });

              const creationEntry = channelAuditLogs.entries.find(
                (entry) => entry.target?.id === channel.id,
              );
              if (creationEntry && creationEntry.executor) {
                const creatorId = creationEntry.executor.id;

                if (
                  (await isBotWhitelisted(creatorId, guild.client)) ||
                  creationEntry.executor.flags?.has(
                    UserFlagsBitField.Flags.VerifiedBot,
                  )
                ) {
                  return {
                    success: false,
                    channelId: channel.id,
                    source,
                    error:
                      'Salon créé par bot whitelisté/vérifié - suppression annulée',
                  };
                }
              }
            } catch {
              return {
                success: false,
                channelId: channel.id,
                source,
                error:
                  'Impossible de vérifier le créateur - suppression annulée par sécurité',
              };
            }
            const deletePromise = freshChannel.delete(
              `🚨 Bot malveillant ${botId} - GLaDOS Ultra-Fast (${source})`,
            );
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Timeout suppression')),
                ANTI_RAID_CONFIG.EMERGENCY.IMMEDIATE_BAN_TIMEOUT,
              ),
            );

            await Promise.race([deletePromise, timeoutPromise]);

            result.channelsDeleted++;

            return {
              success: true,
              channelId: channel.id,
              source,
            };
          } catch (deleteError) {
            if (deleteError.code === 10003) {
              return {
                success: true,
                channelId: channel.id,
                source,
                alreadyDeleted: true,
              };
            }

            result.errors.push(
              `${channel.name} (${source}): ${deleteError.message}`,
            );
            return {
              success: false,
              channelId: channel.id,
              error: deleteError.message,
            };
          }
        },
      );

      await Promise.allSettled(deletionPromises);

      const deletionEndTime = process.hrtime.bigint();
      result.timing.deletion =
        Number(deletionEndTime - deletionStartTime) / 1000000;
    }
    const totalEndTime = process.hrtime.bigint();
    result.timing.total = Number(totalEndTime - startTime) / 1000000;

    recordDetectionMetric(result.timing.detection, guild.id, botId);
    recordNeutralizationMetric(
      result.timing.total,
      guild.id,
      botId,
      result.channelsDeleted,
      true,
    );

    return result;
  } catch (error) {
    const errorEndTime = process.hrtime.bigint();
    result.timing.total = Number(errorEndTime - startTime) / 1000000;
    result.errors.push(`Erreur générale: ${error.message}`);
    return result;
  }
}

async function banMaliciousBotWithReport(guild, botId, neutralizationResult) {
  if (
    (await isBotWhitelisted(botId, guild.client)) ||
    botId === guild.client.user.id
  ) {
    return {
      banned: false,
      reportSent: false,
      errors: ['Bot vérifié, whitelisté ou self-bot, aucune action'],
    };
  }

  const result = {
    banned: false,
    reportSent: false,
    errors: [],
  };

  try {
    if (!botId || botId === 'undefined' || !/^\d{17,19}$/.test(botId)) {
      result.errors.push('ID bot invalide');
      return result;
    }

    if (!neutralizationResult.permissionsRemoved) {
      await removeAllBotPermissions(guild, botId);
    }

    if (
      !hasReportBeenSentRecently(guild.id, 'mass_create_neutralized', botId)
    ) {
      try {
        await sendUniqueRaidReport(
          guild,
          '🚨 BOT MALVEILLANT NEUTRALISÉ - CRÉATION MASSIVE',
          {
            description:
              `**ATTAQUE DE CRÉATION MASSIVE STOPPÉE**\n\n` +
              `**Bot Malveillant:** <@${botId}> (${botId})\n` +
              `**Type d'attaque:** Création massive de salons\n` +
              `**Salons trouvés:** ${neutralizationResult.channelsFound || 0}\n` +
              `**Salons supprimés:** ${neutralizationResult.channelsDeleted || 0}\n` +
              `**Permissions retirées:** ${neutralizationResult.permissionsRemoved ? '<:true:1180540823557918812> OUI' : '❌ ÉCHEC'}\n\n` +
              `**🛡️ ACTIONS PRISES:**\n` +
              `<:true:1180540823557918812> Permissions du bot complètement retirées\n` +
              `<:true:1180540823557918812> Tous les salons malveillants supprimés\n` +
              `<:true:1180540823557918812> Bot en cours de bannissement permanent\n` +
              `<:true:1180540823557918812> Serveur sécurisé et restauré\n\n` +
              `**Status:** 🟢 NEUTRALISATION TERMINÉE`,
            color: embedColor,
          },
          'mass_create_neutralized',
          botId,
        );
        result.reportSent = true;
      } catch (reportError) {
        result.errors.push(`Erreur envoi rapport: ${reportError.message}`);
      }
    }

    if (await isBotWhitelisted(botId, guild.client)) {
      result.errors.push('Bot vérifié Discord ignoré');
      return result;
    }

    try {
      await guild.bans.create(botId, {
        reason: `Création massive de salons détectée - ${neutralizationResult.channelsDeleted} salons supprimés - Bot neutralisé par GLaDOS`,
      });
      result.banned = true;

      markBotAsMalicious(botId, true, true);

      setImmediate(() => scheduleDelayedChannelCleanup(guild, botId));
    } catch (banError) {
      if (banError.code === 10013) {
        result.errors.push(`Bot ${botId} n'existe plus sur Discord`);

        markBotAsMalicious(botId, true, true);
      } else {
        result.errors.push(`Erreur bannissement: ${banError.message}`);
      }

      markBotAsMalicious(botId, true, true);
    }

    try {
      const AUDIT_LOG_TIME_LIMIT = 5 * 60 * 1000;
      const now = Date.now();
      const auditLogs = await guild.fetchAuditLogs({
        limit: 100,
        type: AuditLogEvent.ChannelCreate,
      });
      for (const entry of auditLogs.entries.values()) {
        if (
          entry.executor?.id === botId &&
          now - entry.createdTimestamp <= AUDIT_LOG_TIME_LIMIT
        ) {
          const channelId = entry.target?.id;

          if (
            (await isBotWhitelisted(entry.executor.id, guild.client)) ||
            entry.executor.flags?.has(UserFlagsBitField.Flags.VerifiedBot)
          ) {
            continue;
          }

          const channel = guild.channels.cache.get(channelId);
          if (channel && channel.type === 0) {
            try {
              await channel.delete(
                `Salon créé par bot malveillant ${botId} - Suppression post-ban (audit log cross-check)`,
              );
            } catch (deleteError) {
              result.errors.push(
                `Erreur suppression post-ban salon ${channel.name}: ${deleteError.message}`,
              );
            }
          }
        }
      }
      for (const channel of guild.channels.cache.values()) {
        if (channel.type !== 0) continue;

        if (now - channel.createdTimestamp > AUDIT_LOG_TIME_LIMIT) continue;

        try {
          const channelAuditLogs = await guild.fetchAuditLogs({
            limit: 5,
            type: AuditLogEvent.ChannelCreate,
          });

          const creationEntry = channelAuditLogs.entries.find(
            (entry) => entry.target?.id === channel.id,
          );
          if (creationEntry && creationEntry.executor) {
            if (
              (await isBotWhitelisted(
                creationEntry.executor.id,
                guild.client,
              )) ||
              creationEntry.executor.flags?.has(
                UserFlagsBitField.Flags.VerifiedBot,
              )
            ) {
              continue;
            }
          }
        } catch {
          continue;
        }

        const foundInLogs = Array.from(auditLogs.entries.values()).some(
          (entry) =>
            entry.executor?.id === botId &&
            entry.target?.id === channel.id &&
            now - entry.createdTimestamp <= AUDIT_LOG_TIME_LIMIT,
        );

        if (!foundInLogs) {
          if (
            /^(raid|spam|hack|nuke|delete|destroy|temp|test|bot|auto)/i.test(
              channel.name,
            )
          ) {
            try {
              await channel.delete(
                `Salon suspect créé par bot malveillant ${botId} - Suppression post-ban (cross-check fallback)`,
              );
            } catch (deleteError) {
              result.errors.push(
                `Erreur suppression fallback salon ${channel.name}: ${deleteError.message}`,
              );
            }
          }
        }
      }
    } catch (auditError) {
      result.errors.push(
        `Erreur fetch/suppression audit logs post-ban: ${auditError.message}`,
      );
    }

    return result;
  } catch (error) {
    result.errors.push(`Erreur générale bannissement: ${error.message}`);
    return result;
  }
}

async function neutralizeMaliciousBot(guild, botId, channelNames = []) {
  if (
    (await isBotWhitelisted(botId, guild.client)) ||
    botId === guild.client.user.id
  ) {
    return {
      permissionsRemoved: false,
      channelsDeleted: 0,
      channelsVerified: false,
      botBanned: false,
      serverEmpty: false,
      restorationTriggered: false,
      errors: ['Bot vérifié, whitelisté ou self-bot, aucune action'],
    };
  }

  const result = {
    permissionsRemoved: false,
    channelsDeleted: 0,
    channelsVerified: false,
    botBanned: false,
    serverEmpty: false,
    restorationTriggered: false,
    errors: [],
  };
  try {
    if (await isBotWhitelisted(botId, guild.client)) {
      result.errors.push('Bot vérifié Discord ignoré');
      return result;
    }

    try {
      await guild.bans.create(botId, {
        reason:
          'GLaDOS Ban First: Création massive de salons - Bannissement immédiat',
      });
      result.botBanned = true;
      markBotAsMalicious(botId);
    } catch (banError) {
      const errorMsg = `Erreur bannissement immédiat: ${banError.message}`;
      result.errors.push(errorMsg);
    }

    setImmediate(async () => {
      try {
        result.permissionsRemoved = await removeAllBotPermissions(guild, botId);
      } catch (permError) {
        if (ANTI_RAID_CONFIG.DEBUG?.ENABLED) {
          console.error('Erreur retrait permissions:', permError.message);
        }
      }
    });

    setTimeout(async () => {
      try {
        const batchSize = 3;
        const batches = [];
        for (let i = 0; i < channelNames.length; i += batchSize) {
          batches.push(channelNames.slice(i, i + batchSize));
        }

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const deletionPromises = batch.map(async (channelName) => {
            const channelToDelete = guild.channels.cache.find(
              (c) => c.name === channelName,
            );
            if (channelToDelete) {
              try {
                await channelToDelete.delete(
                  'GLaDOS Delayed Cleanup: Salon créé par bot banni',
                );
                result.channelsDeleted++;
              } catch (deleteError) {
                const errorMsg = `Erreur suppression différée "${channelName}": ${deleteError.message}`;
                result.errors.push(errorMsg);
              }
            }
          });

          await Promise.allSettled(deletionPromises);

          if (i < batches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        result.channelsVerified = await verifyChannelsDeletionFor7Seconds(
          guild,
          botId,
          channelNames,
        );

        result.serverEmpty = isServerEmptyAfterRaid(guild);

        if (result.serverEmpty) {
          try {
            if (guild && guild.available && guild.channels) {
              await startServerRestoration(guild, null, botId);
              result.restorationTriggered = true;
            } else {
              result.errors.push('Guild non disponible pour la restauration');
            }
          } catch (restorationError) {
            result.errors.push(
              `Erreur déclenchement restauration: ${restorationError.message}`,
            );
          }
        }
      } catch (cleanupError) {
        result.errors.push(`Erreur nettoyage différé: ${cleanupError.message}`);
      }
    }, 10000);

    return result;
  } catch (error) {
    result.errors.push(`Erreur générale: ${error.message}`);
    return result;
  }
}

async function verifyChannelsDeletionFor7Seconds(
  guild,
  botId,
  originalChannelNames,
) {
  const VERIFICATION_DURATION = 7000;
  const CHECK_INTERVAL = 500;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const verificationInterval = setInterval(async () => {
      const elapsedTime = Date.now() - startTime;

      if (elapsedTime >= VERIFICATION_DURATION) {
        clearInterval(verificationInterval);
        resolve(true);
        return;
      }

      const remainingChannels = guild.channels.cache.filter(
        (c) => originalChannelNames.includes(c.name) && c.type === 0,
      );

      if (remainingChannels.size > 0) {
        for (const channel of remainingChannels.values()) {
          try {
            const channelAuditLogs = await guild.fetchAuditLogs({
              limit: 5,
              type: AuditLogEvent.ChannelCreate,
            });

            const creationEntry = channelAuditLogs.entries.find(
              (entry) => entry.target?.id === channel.id,
            );
            if (creationEntry && creationEntry.executor) {
              if (
                (await isBotWhitelisted(
                  creationEntry.executor.id,
                  guild.client,
                )) ||
                creationEntry.executor.flags?.has(
                  UserFlagsBitField.Flags.VerifiedBot,
                )
              ) {
                continue;
              }
            }
          } catch {
            continue;
          }

          await channel.delete(
            'Suppression supplémentaire salon bot malveillant',
          );
        }
      } else {
        clearInterval(verificationInterval);
        resolve(true);
      }
    }, CHECK_INTERVAL);

    setTimeout(() => {
      clearInterval(verificationInterval);
      resolve(true);
    }, VERIFICATION_DURATION + 1000);
  });
}

async function handleChannelCreateRaid(channel) {
  if (!channel || !channel.guild || !channel.guild.available) {
    return;
  }

  const guildId = channel.guild.id;

  try {
    if (!hasManageChannelsPermission(channel.guild)) {
      return;
    }

    const now = Date.now();
    const ultraAuditLogs = await channel.guild.fetchAuditLogs({
      limit: 10,
      type: 10,
    });
    const entries = Array.from(ultraAuditLogs.entries.values());

    const firstBotEntry = entries.find(
      (e) => e.executor?.bot && !e.executor.flags?.has?.('VerifiedBot'),
    );
    if (firstBotEntry && now - firstBotEntry.createdTimestamp < 5000) {
      pauseGuild(guildId);
      markGuildAsProcessingChannelRaid(guildId, firstBotEntry.executor.id);
      setTimeout(() => {
        unpauseGuild(guildId);
        console.log(
          `[AntiRaid] ⏸️ Pause levée automatiquement sur ${guildId} après 10 secondes`,
        );
      }, 10000);
    }

    const recentBots = {};
    for (const entry of entries) {
      const { executor, createdTimestamp, target } = entry;
      if (!executor?.bot || executor.flags?.has?.('VerifiedBot')) continue;
      if (now - createdTimestamp > 3000) continue;
      if (!recentBots[executor.id]) recentBots[executor.id] = [];
      recentBots[executor.id].push(target.id);
    }
    for (const [botId, channelIds] of Object.entries(recentBots)) {
      if (channelIds.length >= 2) {
        const firstChannelTime =
          entries.find((e) => e.target?.id === channelIds[0])
            ?.createdTimestamp || now;
        const lastChannelTime =
          entries.find(
            (e) => e.target?.id === channelIds[channelIds.length - 1],
          )?.createdTimestamp || now;
        const timeDiff = Math.abs(lastChannelTime - firstChannelTime);

        if (timeDiff <= 1000) {
          setGuildRaidFlag(guildId, true);
          pauseGuild(guildId);
          markGuildAsProcessingChannelRaid(guildId, botId);
          console.warn(
            `[UltraAntiRaid] 🚨 RAID ULTRA-RAPIDE DÉTECTÉ: ${botId} a créé ${channelIds.length} salons en ${timeDiff}ms sur ${guildId}`,
          );

          markBotAsMalicious(botId, true, true);

          try {
            await channel.guild.bans.create(botId, {
              reason: `Raid ultra-rapide: ${channelIds.length} salons créés en ${timeDiff}ms - Bannissement immédiat`,
            });
            console.log(
              `[UltraAntiRaid] ✓ Bot ${botId} BANNI IMMÉDIATEMENT pour raid ultra-rapide`,
            );
          } catch (banError) {
            console.error(
              `[UltraAntiRaid] Erreur ban immédiat bot ${botId}:`,
              banError.message,
            );
          }

          const deletedCount = await deleteAllRecentChannelsByBot(
            channel.guild,
            botId,
            10000,
          );
          console.log(
            `[UltraAntiRaid] ${deletedCount} salons supprimés pour le bot ${botId}`,
          );

          setTimeout(() => {
            setGuildRaidFlag(guildId, false);
            unpauseGuild(guildId);
            console.log(
              `[UltraAntiRaid] Reprise des events sur ${guildId} après neutralisation ultra-rapide.`,
            );
          }, 10000);

          return;
        }
      }

      if (channelIds.length >= 4 && !isGuildInRaid(guildId)) {
        setGuildRaidFlag(guildId, true);
        pauseGuild(guildId);
        markGuildAsProcessingChannelRaid(guildId, botId);
        console.warn(
          `[UltraAntiRaid] RAID détecté: ${botId} a créé ${channelIds.length} salons en <3s sur ${guildId}`,
        );

        markBotAsMalicious(botId, true, true);

        const deletedCount = await deleteAllRecentChannelsByBot(
          channel.guild,
          botId,
          10000,
        );
        console.log(
          `[UltraAntiRaid] ${deletedCount} salons supprimés pour le bot ${botId}`,
        );

        const banOk = await banUserWS(
          channel.guild,
          botId,
          'Raid: création massive de salons',
        );
        if (banOk) {
          console.log(
            `[UltraAntiRaid] Bot de raid ${botId} banni avec succès.`,
          );

          try {
            const postBanLogs = await channel.guild.fetchAuditLogs({
              type: 10,
              limit: 50,
            });
            const now2 = Date.now();
            const postBanChannels = postBanLogs.entries
              .filter(
                (e) =>
                  e.executorId === botId &&
                  now2 - e.createdTimestamp < 5 * 60 * 1000,
              )
              .map((e) => channel.guild.channels.cache.get(e.target.id))
              .filter(Boolean);
            if (postBanChannels.length > 0) {
              console.log(
                `[UltraAntiRaid] Suppression post-ban de ${postBanChannels.length} salons restants pour le bot ${botId}...`,
              );
            } else {
              console.log(
                `[UltraAntiRaid] Aucun salon à supprimer post-ban pour le bot ${botId}.`,
              );
            }
          } catch (err) {
            console.error(
              '[UltraAntiRaid] Erreur lors du cross-check suppression post-ban:',
              err,
            );
          }
        } else {
          console.error(`[UltraAntiRaid] Échec du ban du bot ${botId}`);
        }
        setTimeout(() => {
          setGuildRaidFlag(guildId, false);
          unpauseGuild(guildId);
          console.log(
            `[UltraAntiRaid] Reprise des events sur ${guildId} après neutralisation.`,
          );
        }, 10000);

        return;
      }
    }
    if (ANTI_RAID_CONFIG.MASS_CREATE.ULTRA_FAST_MODE) {
      const ultraFastResult = await instantChannelCreateDetection(channel);
      if (ultraFastResult) {
        return;
      }
    }

    setAntiPubDisabled(guildId, true);

    const auditLogs = await channel.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelCreate,
    });

    const { executor } = auditLogs.entries.first() || {};
    const creatorId = executor?.id;
    if (!creatorId || (await isWhitelisted(creatorId, channel.guild.client))) {
      setAntiPubDisabled(guildId, false);
      return;
    }

    const isCreatorBot = executor?.bot || false;

    if (isCreatorBot) {
      const isVerifiedBot =
        executor?.flags?.has(UserFlagsBitField.Flags.VerifiedBot) || false;
      if (isVerifiedBot) {
        setAntiPubDisabled(guildId, false);
        return;
      }
    }

    if (!isCreatorBot) {
      if (await isWhitelisted(creatorId, channel.guild.client)) {
        setAntiPubDisabled(guildId, false);
        return;
      }
    }

    const returnAction = await handleMaliciousBotReturn(
      channel.guild,
      creatorId,
      'attack',
    );
    if (returnAction === 'rebanned') {
      setAntiPubDisabled(guildId, false);
      return;
    } else if (returnAction === 'reset_data') {
      const neutralizationStart = process.hrtime.bigint();

      markGuildUnderAttack(guildId, 'mass_create_repeat', creatorId);
      markGuildAsProcessingChannelRaid(guildId, creatorId);
      const deleteReason = 'Bot récidiviste - Suppression immédiate GLaDOS';

      markBotAsMalicious(creatorId, true, true);

      await channel.delete(deleteReason);

      const neutralizeResult = await executeOptimizedNeutralization(
        channel.guild,
        creatorId,
      );

      const neutralizationEnd = process.hrtime.bigint();
      const neutralizationTime =
        Number(neutralizationEnd - neutralizationStart) / 1000000000;

      setAntiPubDisabled(guildId, false);

      setImmediate(async () => {
        const raidChannel = channel.guild.channels.cache.find(
          (c) =>
            c.type === 0 &&
            c
              .permissionsFor(channel.guild.members.me)
              .has(['SendMessages', 'ViewChannel']) &&
            (c.name.includes('general') || c.name.includes('chat')),
        );

        if (raidChannel) {
          const alertDescription =
            `> <a:warning:1269193959503040553> Un bot de raid **récidiviste** est revenu attaquer.\n` +
            `> <a:interdit:1269193896790065152> J'ai **neutralisé le bot récidiviste en ${neutralizationTime.toFixed(3)}s**, **supprimé ${neutralizeResult.channelsDeleted} salons** et **rebanni le bot**.\n` +
            `> <a:valider:1298662697185050634> **Réaction ultra-rapide** - serveur maintenant sûr.`;

          const alertEmbed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(alertDescription)
            .setImage('attachment://raid.png');

          await raidChannel
            .send({
              embeds: [alertEmbed],
              files: [
                {
                  attachment: `http://localhost:9871/captcha-reverse/Anti-Raid`,
                  name: 'raid.png',
                },
              ],
            })
            .catch(() => {});
        }
      });

      return;
    }

    recordChannelCreationByBot(
      channel.guild,
      creatorId,
      channel.id,
      channel.name,
    );
    if (isBotMalicious(creatorId)) {
      const deleteReason =
        'Salon créé par bot malveillant - Suppression automatique GLaDOS';

      await channel.delete(deleteReason);

      if (isComboRaidInProgress(guildId, creatorId)) {
        updateComboRaidState(guildId, creatorId, 'creation', {
          creations: 1,
        });
      }
      return;
    }
    const guildCache = raidDetectionCache.get(guildId) || {
      channels: [],
      lastCleanup: Date.now(),
      botActivityTracker: new Map(),
    };

    const nowCheck = Date.now();

    if (
      nowCheck - guildCache.lastCleanup > TIME_WINDOW ||
      guildCache.channels.length > 50
    ) {
      guildCache.channels = guildCache.channels.filter(
        (c) => nowCheck - c.time < TIME_WINDOW,
      );
      guildCache.lastCleanup = nowCheck;

      for (const [botId, lastActivity] of guildCache.botActivityTracker) {
        if (nowCheck - lastActivity > TIME_WINDOW * 2) {
          guildCache.botActivityTracker.delete(botId);
        }
      }
    }

    guildCache.channels.push({
      name: channel.name,
      time: nowCheck,
      creatorId,
    });
    guildCache.botActivityTracker.set(creatorId, nowCheck);
    raidDetectionCache.set(guildId, guildCache);

    const recentChannels = guildCache.channels.filter(
      (c) => c.creatorId === creatorId && nowCheck - c.time < TIME_WINDOW,
    );

    const channelNames = recentChannels.map((c) => c.name);
    const hasUltraSuspiciousPattern = channelNames.some(
      (name) =>
        /^(raid|spam|hack|nuke|delete|destroy|test)\d*$/i.test(name) ||
        /^(general|chat|random|test)\d+$/i.test(name) ||
        /[0-9]{10,}/.test(name),
    );

    const dynamicThreshold =
      hasUltraSuspiciousPattern ?
        Math.max(5, RAID_THRESHOLD)
      : Math.max(5, RAID_THRESHOLD);

    const activityKey = `${guildId}_${creatorId}_activity`;
    if (!raidDetectionCache.has(activityKey)) {
      recordSuspiciousActivity(guildId, creatorId, 'creation', 1);
      raidDetectionCache.set(activityKey, nowCheck);
      setTimeout(() => raidDetectionCache.delete(activityKey), TIME_WINDOW);
    }
    const comboKey = `${guildId}_${creatorId}_combo`;
    let comboState = raidDetectionCache.get(comboKey);

    if (comboState === undefined) {
      comboState = getComboRaidState(guildId, creatorId);
      raidDetectionCache.set(comboKey, comboState);

      setTimeout(() => raidDetectionCache.delete(comboKey), TIME_WINDOW);
    }
    if (comboState) {
      const deleteReason =
        'Salon créé pendant raid combo - Suppression automatique GLaDOS';

      await channel.delete(deleteReason);
      updateComboRaidState(guildId, creatorId, 'creation', {
        creations: 1,
      });

      raidDetectionCache.delete(comboKey);
      return;
    }
    if (recentChannels.length >= dynamicThreshold) {
      markGuildUnderAttack(guildId, 'mass_create', creatorId);
      markGuildAsProcessingChannelRaid(guildId, creatorId);

      markBotAsMalicious(creatorId, true, true);

      if (
        creatorId === channel.guild.ownerId ||
        whitelist.OwnerByPass.includes(creatorId)
      ) {
        setAntiPubDisabled(guildId, false);
        return;
      }
    } else {
      setAntiPubDisabled(guildId, false);
    }
  } catch (error) {
    setAntiPubDisabled(guildId, false);

    if ([50013, 50001, 10003, 10004, 10006].includes(error.code)) {
      return;
    }
  }
}

async function executeOptimizedNeutralization(guild, botId) {
  const startTime = process.hrtime.bigint();
  const result = {
    permissionsRemoved: false,
    channelsFound: 0,
    channelsDeleted: 0,
    botBanned: false,
    reportSent: false,
    serverEmpty: false,
    restorationTriggered: false,
    errors: [],
    totalTime: 0,
  };

  try {
    result.permissionsRemoved = await removeAllBotPermissions(guild, botId);

    if (!result.permissionsRemoved) {
      result.errors.push('Échec retrait permissions - continuons quand même');
    }

    const deletionResult = await deleteAllChannelsCreatedByMaliciousBot(
      guild,
      botId,
    );

    result.channelsFound = deletionResult.channelsFound;
    result.channelsDeleted = deletionResult.channelsDeleted;

    if (deletionResult.errors.length > 0) {
      result.errors.push(...deletionResult.errors);
    }
    const banResult = await banMaliciousBotWithReport(guild, botId, {
      permissionsRemoved: result.permissionsRemoved,
      channelsFound: result.channelsFound,
      channelsDeleted: result.channelsDeleted,
      methods: deletionResult.methods || {},
      errors: result.errors,
    });

    result.botBanned = banResult.banned;
    result.reportSent = banResult.reportSent;

    if (banResult.errors.length > 0) {
      result.errors.push(...banResult.errors);
    }

    result.serverEmpty = isServerEmptyAfterRaid(guild);

    if (result.serverEmpty) {
      setImmediate(async () => {
        try {
          if (guild && guild.available && guild.channels) {
            await startServerRestoration(guild, null, botId);
          }
        } catch {
          if (
            !isAntiNukeCreationInProgress(guild.id) &&
            lockAntiNukeCreation(guild.id)
          ) {
            try {
              await guild.channels.create({
                name: 'general',
                type: 0,
                topic:
                  "🚨 Salon d'urgence créé après raid massif - GLaDOS Protection Ultra-Agressive",
                reason: "Création d'urgence après neutralisation agressive",
              });
            } finally {
              unlockAntiNukeCreation(guild.id);
            }
          }
        }
      });

      result.restorationTriggered = true;
    }

    const endTime = process.hrtime.bigint();
    result.totalTime = Number(endTime - startTime) / 1000000000;

    console.log(`📊 [${guild.name}] NEUTRALISATION TERMINÉE:
    <:true:1304519561814741063> Permissions retirées: ${result.permissionsRemoved}
    🗑️ Salons trouvés/supprimés: ${result.channelsFound}/${result.channelsDeleted}
    🔨 Bot banni: ${result.botBanned}
    📋 Rapport envoyé: ${result.reportSent}
    🔄 Restauration: ${result.restorationTriggered}
    ⏱️ Temps total: ${result.totalTime.toFixed(3)}s`);

    return result;
  } catch (error) {
    const endTime = process.hrtime.bigint();
    result.totalTime = Number(endTime - startTime) / 1000000000;
    result.errors.push(`Erreur critique neutralisation: ${error.message}`);

    return result;
  }
}

import {
  banUserWS,
  deleteAllRecentChannelsByBot,
  isGuildInRaid,
  pauseGuild,
  setGuildRaidFlag,
  unpauseGuild,
} from './ultraFastAntiRaid.js';

export {
  banMaliciousBotWithReport,
  deleteAllChannelsCreatedByMaliciousBot,
  executeOptimizedNeutralization,
  handleChannelCreateRaid,
  isServerEmptyAfterRaid,
  neutralizeMaliciousBot,
  removeAllBotPermissions,
};

