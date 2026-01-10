import { Events } from 'discord.js';
import {
  createEmergencyChannel,
  isServerCritical,
  startServerRestoration,
} from '../utils/handleChannelDeleteRaid.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

const criticalRestorationInProgress = new Set();

export const name = Events.ChannelDelete;
export async function execute(channel, shardId) {
  if (!channel.guild) return;

  const guildId = channel.guild.id;

  if (isServerCritical(channel.guild)) {
    if (criticalRestorationInProgress.has(guildId)) {
      return;
    }

    criticalRestorationInProgress.add(guildId);

    try {
      const emergencyChannel = await createEmergencyChannel(channel.guild);
      await startServerRestoration(channel.guild, emergencyChannel);
    } catch (error) {
      triggerErrorEmbed(error, {
        source: 'channelDelete',
        action: 'critical_server_restoration',
        guildId: guildId,
        shardId,
      });
    } finally {
      setTimeout(() => {
        criticalRestorationInProgress.delete(guildId);
      }, 5000);
    }
  }
}

