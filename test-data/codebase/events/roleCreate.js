import { AuditLogEvent, Events, UserFlagsBitField } from 'discord.js';
import {
  handleMaliciousBotReturn,
  isBotWhitelisted,
  markBotAsMalicious,
} from '../utils/antiRaidCoordinator.js';
import { checkShards } from '../utils/checkShards.js';
import { handleRoleCreateRaid } from '../utils/handleRoleCreateRaid.js';
import { hasAuditLogPermission } from '../utils/logUtils.js';
import { hasBanMembersPermission } from '../utils/permissionsUtils.js';
import { logRoleCreated } from '../utils/roleUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

const roleCreationMap = new Map();

async function handleRoleCreateSpamDetection(role) {
  if (!role || !role.guild || !role.guild.available) {
    return;
  }

  try {
    const auditLogs = await role.guild.fetchAuditLogs({
      limit: 5,
      type: AuditLogEvent.RoleCreate,
    });

    const creationEntry = auditLogs.entries.find(
      (entry) => entry.target?.id === role.id,
    );

    if (!creationEntry || !creationEntry.executor) {
      return;
    }

    const executor = creationEntry.executor;
    const creatorId = executor.id;
    const isBot = executor.bot;

    if (!isBot) {
      return;
    }

    const isVerifiedBot =
      executor.flags?.has(UserFlagsBitField.Flags.VerifiedBot) || false;
    if (isVerifiedBot) {
      return;
    }

    if (await isBotWhitelisted(creatorId, role.client)) {
      return;
    }

    const returnAction = await handleMaliciousBotReturn(
      role.guild,
      creatorId,
      'role_create',
    );

    if (returnAction === 'rebanned') {
      try {
        await role.delete('Bot malveillant rebanni - Suppression automatique');
      } catch (error) {
        console.error(
          'Erreur lors de la suppression du rôle malveillant:',
          error,
        );
      }
      return;
    }

    const limit = 4;
    const now = Date.now();

    if (!roleCreationMap.has(creatorId)) {
      roleCreationMap.set(creatorId, []);
    }

    const arr = roleCreationMap.get(creatorId);
    arr.push(now);

    if (arr.length >= limit - 1 && now - arr[arr.length - limit] < 5000) {
      try {
        if (hasBanMembersPermission(role.guild)) {
          await role.guild.bans.create(creatorId, {
            reason: 'Création massive de rôles détectée - Bot non vérifié',
          });

          markBotAsMalicious(creatorId, true, role.client);

          console.log(
            `[AntiRaid] Bot non vérifié ${creatorId} banni pour spam de création de rôles`,
          );

          try {
            const recentAuditLogs = await role.guild.fetchAuditLogs({
              limit: 20,
              type: AuditLogEvent.RoleCreate,
            });

            const now = Date.now();
            const rolesToDelete = recentAuditLogs.entries
              .filter(
                (entry) =>
                  entry.executor?.id === creatorId &&
                  now - entry.createdTimestamp < 60000,
              )
              .map((entry) => role.guild.roles.cache.get(entry.target.id))
              .filter(Boolean);

            if (rolesToDelete.length > 0) {
              console.log(
                `[AntiRaid] Suppression post-ban de ${rolesToDelete.length} rôles créés par le bot spammeur ${creatorId}...`,
              );

              await Promise.allSettled(
                rolesToDelete.map((r) =>
                  r
                    .delete(
                      'Suppression post-ban bot spammeur (création massive)',
                    )
                    .then(() => {})
                    .catch((err) => {
                      console.error(
                        `[AntiRaid] Échec suppression post-ban rôle ${r.id}:`,
                        err,
                      );
                    }),
                ),
              );
            }
          } catch (auditError) {
            console.error(
              '[AntiRaid] Erreur lors du cross-check suppression post-ban (création rôles):',
              auditError,
            );
          }
        }

        roleCreationMap.set(creatorId, []);
      } catch (error) {
        if (![50013, 50001, 10003, 10008, 50034].includes(error.code)) {
          triggerErrorEmbed(error, {
            source: 'roleCreateSpamDetection',
            action: 'ban_bot',
            botId: creatorId,
            guildId: role.guild.id,
          });
        }
      }
    }

    if (arr.length > 20) {
      roleCreationMap.set(
        creatorId,
        arr.filter((time) => now - time < 10000),
      );
    }
  } catch (error) {
    if (![50013, 50001, 10003, 10008].includes(error.code)) {
      triggerErrorEmbed(error, {
        source: 'roleCreateSpamDetection',
        action: 'detection',
        guildId: role.guild?.id,
      });
    }
  }
}

export const name = Events.GuildRoleCreate;
export async function execute(role, shardId) {
  if (role.guild && shouldPauseGuild(role.guild.id)) {
    return;
  }
  if (!checkShards(role, shardId)) return;

  try {
    await handleRoleCreateSpamDetection(role);
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'roleCreate',
      action: 'spam_detection',
      guildId: role.guild?.id,
      shardId,
    });
  }

  handleRoleCreateRaid(role);
  if (!hasAuditLogPermission(role.guild)) return;
  await logRoleCreated(role, 'fr');
}

