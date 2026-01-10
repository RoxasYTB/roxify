import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import { markGuildSecure } from './antiRaidCoordinator.js';
import { sendUniqueRaidReport } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const RAID_REPORT_TITLE = ANTI_RAID_CONFIG.MESSAGES.MASS_DELETE_TITLE;
const RAID_REPORT_DESCRIPTION =
  ANTI_RAID_CONFIG.MESSAGES.MASS_DELETE_DESCRIPTION;
const RESTORE_DELAY = ANTI_RAID_CONFIG.MASS_DELETE.RESTORE_DELAY;
const TIME_WINDOW = ANTI_RAID_CONFIG.MASS_DELETE.TIME_WINDOW;

async function handleMassiveDeletion(channel, botId, deletions, guild = null) {
  try {
    const targetGuild = guild || channel?.guild;
    if (!targetGuild) {
      return;
    }

    await sendRaidReport(targetGuild, botId, deletions);

    setTimeout(async () => {
      await startServerRestoration(targetGuild, botId);
    }, RESTORE_DELAY);
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleMassiveDeletion.js',
      action: 'handle_massive_deletion',
      guildId: (guild || channel?.guild)?.id,
    });
  }
}

async function sendRaidReport(guild, botId, deletions) {
  await sendUniqueRaidReport(
    guild,
    RAID_REPORT_TITLE,
    {
      description: `${RAID_REPORT_DESCRIPTION}\n\nBot: <@${botId}> (${botId})\nSalons supprimés: ${deletions.length}\nFenêtre temporelle: ${TIME_WINDOW / 1000}s`,
    },
    'massive_deletion',
    botId,
  );
}

async function startServerRestoration(guild, maliciousBotId = null) {
  try {
    const { startServerRestoration: mainRestoration } = await import(
      './handleChannelDeleteRaid.js'
    );

    if (typeof mainRestoration === 'function') {
      await mainRestoration(guild, null, maliciousBotId);
    } else {
      await fallbackRestoration(guild);
    }
  } catch {
    await fallbackRestoration(guild);
  }
}

async function fallbackRestoration(guild) {
  const usableChannels = guild.channels.cache.filter(
    (c) => c.type === 0 && c.isTextBased(),
  );

  if (usableChannels.size === 0) {
    await guild.channels.create({
      name: 'general',
      type: 0,
      topic: 'Salon restauré automatiquement par GLaDOS',
      reason: "Restauration d'urgence après suppression massive",
    });
  }

  markGuildSecure(guild.id);
}

export {
  fallbackRestoration,
  handleMassiveDeletion,
  sendRaidReport,
  startServerRestoration,
};

