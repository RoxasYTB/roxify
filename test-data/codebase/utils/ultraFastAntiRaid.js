import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import {
  disableAntipub,
  isRaidInProgress,
  setRaidFlag,
} from '../config/antiRaidHelpers.js';

async function banUserWS(guild, userId, reason = 'Raid detected') {
  try {
    const timeout = ANTI_RAID_CONFIG.GENERAL?.LIGHTNING_BAN_TIMEOUT || 500;
    const banPromise = guild.members.ban(userId, { reason });
    await Promise.race([
      banPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Ban timeout')), timeout),
      ),
    ]);
    return true;
  } catch (e) {
    console.error('[AntiRaid] Erreur ban via WS:', e);
    return false;
  }
}

async function deleteChannelWS(channel) {
  try {
    if (!channel) {
      console.warn('[AntiRaid] Salon introuvable pour suppression.');
      return false;
    }
    console.log(
      `[AntiRaid] Suppression du salon ${channel.id} (${channel.name})...`,
    );
    await channel.delete('Raid cleanup');

    return true;
  } catch (e) {
    console.error(
      `[AntiRaid] Erreur suppression salon via WS (${channel?.id}):`,
      e,
    );
    return false;
  }
}

async function deleteAllRecentChannelsByBot(guild, botId, since = 10000) {
  try {
    await guild.channels.fetch();
    const now = Date.now();
    const auditLogs = await guild.fetchAuditLogs({
      type: 10,
      limit: 100,
    });
    const toDelete = auditLogs.entries
      .filter((e) => e.executorId === botId && now - e.createdTimestamp < since)
      .map((e) => guild.channels.cache.get(e.target.id))
      .filter(Boolean);
    if (toDelete.length > 0) {
      console.log(
        `[AntiRaid] Suppression de ${toDelete.length} salons créés par le bot ${botId}...`,
      );
      const results = await Promise.allSettled(toDelete.map(deleteChannelWS));
      results.forEach((res, idx) => {
        if (res.status === 'rejected' || res.value === false) {
          const ch = toDelete[idx];
          console.error(
            `[AntiRaid] Échec suppression salon: ${ch?.id} (${ch?.name})`,
          );
        }
      });
    } else {
    }
    return toDelete.length;
  } catch (e) {
    console.error('[AntiRaid] Erreur suppression salons du bot:', e);
    return 0;
  }
}

let raidState = new Map();

function setGuildRaidFlag(guildId, value) {
  if (!raidState.has(guildId))
    raidState.set(guildId, { inRaid: false, bots: new Map() });
  raidState.get(guildId).inRaid = value;
}
function isGuildInRaid(guildId) {
  return raidState.get(guildId)?.inRaid === true;
}
function clearGuildRaid(guildId) {
  raidState.delete(guildId);
}

const pausedGuilds = new Set();

function shouldPauseGuild(guildId) {
  return pausedGuilds.has(guildId);
}

function pauseGuild(guildId) {
  pausedGuilds.add(guildId);
}

function unpauseGuild(guildId) {
  pausedGuilds.delete(guildId);
}

function setupUltraFastAntiRaid(client) {
  let channelCreateMap = new Map();
  let recentCreatedChannels = new Map();

  client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    const now = Date.now();
    const guildId = channel.guild.id;
    if (!raidState.has(guildId))
      raidState.set(guildId, { inRaid: false, bots: new Map() });
    const state = raidState.get(guildId);

    let botId = null;
    try {
      const auditLogs = await channel.guild.fetchAuditLogs({
        type: 10,
        limit: 1,
      });
      const entry = auditLogs.entries.first();
      if (entry && entry.target.id === channel.id) {
        botId = entry.executorId;
        if (!state.bots.has(botId)) {
          state.bots.set(botId, { channels: new Set(), first: now });
        }
        state.bots.get(botId).channels.add(channel.id);

        for (const [bId, data] of state.bots) {
          if (now - data.first > 4000) state.bots.delete(bId);
        }

        const botData = state.bots.get(botId);
        if (
          botData.channels.size >= 4 &&
          now - botData.first <= 3000 &&
          !state.inRaid
        ) {
          state.inRaid = true;
          setGuildRaidFlag(guildId, true);
          pauseGuild(guildId);
          console.warn(
            `[AntiRaid] Détection RAID: ${botId} a créé ${botData.channels.size} salons en ${now - botData.first}ms sur ${guildId}`,
          );

          const allChannels = Array.from(botData.channels)
            .map((cid) => channel.guild.channels.cache.get(cid))
            .filter(Boolean);

          let auditToDelete = [];
          try {
            const logs = await channel.guild.fetchAuditLogs({
              type: 10,
              limit: 20,
            });
            auditToDelete = logs.entries
              .filter(
                (e) =>
                  e.executorId === botId && now - e.createdTimestamp < 10000,
              )
              .map((e) => channel.guild.channels.cache.get(e.target.id))
              .filter(Boolean);
          } catch (e) {
            console.error(
              "[AntiRaid] Erreur lors de la récupération des logs d'audit:",
              e,
            );
          }
          const uniqueChannels = new Set([...allChannels, ...auditToDelete]);
          for (const ch of uniqueChannels) {
            console.log(
              `[AntiRaid] Suppression du salon ${ch.id} (${ch.name}) créé par le bot de raid...`,
            );
            try {
              await deleteChannelWS(ch);
            } catch (err) {
              console.error(
                `[AntiRaid] Échec suppression salon ${ch.id}:`,
                err,
              );
            }
          }

          try {
            await banUserWS(
              channel.guild,
              botId,
              'Raid: création massive de salons',
            );
          } catch (e) {
            console.error('[AntiRaid] Erreur lors du ban du bot de raid:', e);
          }

          state.bots.delete(botId);
          setTimeout(() => {
            state.inRaid = false;
            clearGuildRaid(guildId);
            unpauseGuild(guildId);
            console.log(
              `[AntiRaid] Reprise des events sur ${guildId} après neutralisation du raid.`,
            );
          }, 10000);
        }
      }
    } catch (e) {
      console.error('[AntiRaid] Erreur principale dans channelCreate:', e);
    }

    channelCreateMap.set(
      guildId,
      channelCreateMap.get(guildId)?.filter((e) => now - e.createdAt < 2000) ||
        [],
    );

    for (const [suspectBotId, channelIds] of (
      recentCreatedChannels.get(guildId) || new Map()
    ).entries()) {
      if (channelIds.length >= 4 && !isRaidInProgress(guildId)) {
        setRaidFlag(guildId, true);
        if (ANTI_RAID_CONFIG.MASS_CREATE?.DISABLE_ANTIPUB_ON_RAID)
          disableAntipub();
        console.warn(
          `[AntiRaid] Raid détecté sur ${guildId} par ${suspectBotId} : ${channelIds.length} salons créés en rafale.`,
        );

        console.log(
          `[AntiRaid] Suppression de tous les salons créés par ${suspectBotId} avant ban...`,
        );
        await deleteAllRecentChannelsByBot(channel.guild, suspectBotId, 20000);

        try {
          await banUserWS(
            channel.guild,
            suspectBotId,
            'Raid: création massive de salons',
          );
          console.log(
            `[AntiRaid] Bot de raid ${suspectBotId} banni avec succès.`,
          );
        } catch (e) {
          console.error('[AntiRaid] Erreur lors du ban du bot de raid:', e);
        }
        setRaidFlag(guildId, false);

        recentCreatedChannels.get(guildId).set(suspectBotId, []);
        console.log(
          `[AntiRaid] Reprise des events sur ${guildId} après neutralisation du raid.`,
        );
      }
    }
  });
}

export {
  banUserWS,
  clearGuildRaid,
  deleteAllRecentChannelsByBot,
  isGuildInRaid,
  pauseGuild,
  setGuildRaidFlag,
  setupUltraFastAntiRaid,
  shouldPauseGuild,
  unpauseGuild,
};

