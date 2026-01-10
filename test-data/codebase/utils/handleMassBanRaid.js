import { AuditLogEvent, EmbedBuilder, PermissionsBitField } from 'discord.js';
import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import { embedColor } from '../config/config.js';
import { isBotWhitelisted, markBotAsMalicious } from './antiRaidCoordinator.js';
import { isBotTrusted } from './permissionUtils.js';
import { canModerateUser, hasAuditLogPermission } from './permissionsUtils.js';
import { sendUniqueRaidReport } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';
const sansAccents = (str) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const bannedMembers = {};
const blacklistedCreatorIds = new Set();
let antiRaidEmbedSent = false;

async function handleMassBanRaid(member) {
  try {
    if (!member || !member.guild || !member.guild.available) {
      return;
    }

    const guild = member.guild;

    const botMember = guild.members.cache.get(member.client.user.id);
    if (!botMember) {
      return;
    }

    if (!botMember.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return;
    }

    if (!hasAuditLogPermission(member.guild)) {
      return;
    }

    let audit;
    try {
      const auditLogs = await member.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberBanAdd,
      });
      audit = auditLogs.entries.first();
    } catch (auditError) {
      if (auditError.code === 50013) {
        return;
      }
      triggerErrorEmbed(
        auditError,
        member.client?.user?.username,
        member.client?.user?.displayAvatarURL(),
      );
      return;
    }

    const creatorId = audit?.executor?.id;

    const creatorUser = await member.guild.members
      .fetch(creatorId)
      .catch(() => null);
    if (!creatorUser || !creatorUser.user?.bot) {
      return;
    }

    const isTrusted = await isBotTrusted(creatorId, member.client);

    if (!creatorId || isTrusted || blacklistedCreatorIds.has(creatorId)) {
      return;
    }

    const guildId = member.guild.id;
    bannedMembers[guildId] = bannedMembers[guildId] || [];
    bannedMembers[guildId].push({
      userId: member.id,
      username: member.user.username,
      time: Date.now(),
      creatorId,
    });
    const recentBans = bannedMembers[guildId].filter(
      (m) =>
        m.creatorId === creatorId &&
        Date.now() - m.time < ANTI_RAID_CONFIG.MASS_BAN.TIME_WINDOW,
    );

    if (recentBans.length >= ANTI_RAID_CONFIG.MASS_BAN.WARNING_THRESHOLD) {
      if (typeof markBotAsMalicious === 'function') {
        markBotAsMalicious(creatorId, false, member.client);
      }
    }

    if (recentBans.length >= ANTI_RAID_CONFIG.MASS_BAN.THRESHOLD) {
      blacklistedCreatorIds.add(creatorId);
      const raidChannel = (await member.guild.channels.fetch())
        .filter((c) => c.type === 0)
        .find(
          (c) =>
            ['chat', 'gene', 'discu'].some((term) =>
              sansAccents(c.name).includes(term),
            ) || c.name.includes('💬'),
        );

      if (await isBotWhitelisted(creatorId, member.client)) {
        return;
      }

      if (!(await canModerateUser(guild, creatorId))) {
        return;
      }

      await guild.bans
        .create(creatorId, {
          reason: 'Raid de bannissement massif détecté - GLaDOS Protection',
        })
        .catch(() => {});

      await Promise.all(
        recentBans.map(async ({ userId }) =>
          member.guild.bans.remove(
            userId,
            "Victime d'un raid de bannissement massif - Restauration GLaDOS",
          ),
        ),
      );

      if (raidChannel && !antiRaidEmbedSent) {
        antiRaidEmbedSent = true;

        const imageUrl = `http://localhost:9871/captcha-reverse/Anti-Raid`;
        const imageAttachment = {
          attachment: imageUrl,
          name: 'raid.png',
        };
        await raidChannel
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(ANTI_RAID_CONFIG.MESSAGES.MASS_BAN_ALERT)
                .setImage('attachment://raid.png'),
            ],
            files: [imageAttachment],
          })
          .catch(() => {});

        setTimeout(() => (antiRaidEmbedSent = false), 120000);
      }

      if (typeof sendUniqueRaidReport === 'function') {
        await sendUniqueRaidReport(
          guild,
          '🚨 BANNISSEMENT MASSIF CONTRÉ',
          {
            description:
              `**ATTAQUE DE BANNISSEMENT MASSIF DÉTECTÉE**\n\n` +
              `**Bot/Utilisateur Malveillant:** <@${creatorId}> (${creatorId})\n` +
              `**Membres bannis:** ${recentBans.length}\n` +
              `**Actions Prises:**\n` +
              `<:true:1180540823557918812> Attaquant banni\n` +
              `<:true:1180540823557918812> ${recentBans.length} victimes débannis\n\n` +
              `**Status:** 🟢 Menace neutralisée`,
            color: 0x00ff00,
          },
          'mass_ban_detection',
          creatorId,
        );
      }
    }
    setTimeout(() => {
      bannedMembers[guildId] =
        bannedMembers[guildId]?.filter(
          (m) =>
            m.time > Date.now() - ANTI_RAID_CONFIG.MASS_BAN.BLACKLIST_DURATION,
        ) || [];

      if (bannedMembers[guildId].length === 0) {
        const currentTime = Date.now();

        if (
          currentTime % ANTI_RAID_CONFIG.MASS_BAN.BLACKLIST_DURATION <
          ANTI_RAID_CONFIG.MASS_BAN.CLEANUP_INTERVAL
        ) {
          blacklistedCreatorIds.clear();
        }
      }
    }, ANTI_RAID_CONFIG.MASS_BAN.CLEANUP_INTERVAL);
  } catch (error) {
    triggerErrorEmbed(
      error,
      member.client?.user?.username,
      member.client?.user?.displayAvatarURL(),
    );
  }
}

export { handleMassBanRaid };

