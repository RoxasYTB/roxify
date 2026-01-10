import { AuditLogEvent, UserFlagsBitField } from 'discord.js';
import whitelist from '../whitelist.json' with { type: 'json' };
import {
  isBotWhitelisted,
  markBotAsMalicious,
  markGuildSecure,
  recordBlockedAction,
} from './antiRaidCoordinator.js';
import { isBotTrusted } from './permissionUtils.js';
import {
  canModerateUser,
  hasBanMembersPermission,
  hasManageChannelsPermission,
} from './permissionsUtils.js';
import { sendUniqueRaidReport } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const sansAccents = (str) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const renameLogMap = new Map();

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

async function handleChannelUpdate(oldChannel, newChannel) {
  if (!oldChannel || !newChannel || !newChannel.guild) {
    return;
  }
  try {
    if (!hasManageChannelsPermission(newChannel.guild)) {
      return;
    }

    const auditLogs = await newChannel.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelUpdate,
    });
    const creatorId = auditLogs.entries.first()?.executor?.id;

    if (await isWhitelisted(creatorId, newChannel.guild.client)) return;

    try {
      const executor = auditLogs.entries.first()?.executor;
      if (
        executor &&
        executor.bot &&
        executor.flags?.has(UserFlagsBitField.Flags.VerifiedBot)
      ) {
        return;
      }
    } catch (verificationError) {
      console.warn(
        'Erreur lors de la vérification du statut de bot vérifié:',
        verificationError.message,
      );
    }

    if (await isBotTrusted(creatorId, newChannel.guild.client)) return;

    if (oldChannel.name !== newChannel.name) {
      const normalizedName = sansAccents(newChannel.name).toLowerCase();
      const key = `${newChannel.guild.id}:${normalizedName}`;
      const now = Date.now();
      const windowMs = 3000;
      let timestamps = renameLogMap.get(key) ?? [];
      timestamps.push(now);
      timestamps = timestamps.filter((t) => now - t <= windowMs);

      if (timestamps.length > 100) timestamps = timestamps.slice(-100);
      renameLogMap.set(key, timestamps);

      if (timestamps.length >= 5) {
        renameLogMap.delete(key);
        if (await isWhitelisted(creatorId, newChannel.guild.client)) {
          return;
        }

        if (
          creatorId &&
          hasBanMembersPermission(newChannel.guild) &&
          (await canModerateUser(newChannel.guild, creatorId))
        ) {
          await newChannel.guild.bans
            .create(creatorId, {
              reason: "Raid d'update de channel massif détecté",
            })
            .catch(console.error);
        }

        markBotAsMalicious(creatorId);

        recordBlockedAction(
          newChannel.guild.id,
          'channel_rename_spam',
          creatorId,
        );

        markGuildSecure(newChannel.guild.id);

        const revertName = async () => {
          await newChannel.setName(oldChannel.name);
          if (
            sansAccents(newChannel.name).toLowerCase() !==
            sansAccents(oldChannel.name).toLowerCase()
          ) {
            await newChannel.setName(oldChannel.name);
          }
        };

        setTimeout(async () => {
          await revertName();
        }, 10000);
        await sendUniqueRaidReport(
          newChannel.guild,
          'Spam de renommage de salon',
          {
            description: `Un utilisateur a tenté de renommer plusieurs salons avec le même nom "${newChannel.name}"\nAction : Rétablissement du nom d'origine et bannissement de l'utilisateur.`,
          },
          'channel_rename_spam',
          creatorId,
        );
      }
    }
  } catch (error) {
    if ([50013, 50001, 10003, 10004, 10006].includes(error.code)) {
      return;
    }

    triggerErrorEmbed(error, null, null);
  }
}

export { handleChannelUpdate };

