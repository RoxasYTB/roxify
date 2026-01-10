import { Events } from 'discord.js';
import { checkShards } from '../utils/checkShards.js';
import { handleVoiceStateUpdate } from '../utils/handeVoiceStateUpdate.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = Events.VoiceStateUpdate;
export async function execute(oldState, newState, shardId) {
  if (newState.guild && shouldPauseGuild(newState.guild.id)) {
    return;
  }
  if (!checkShards(newState, shardId)) return;
  try {
    await handleVoiceStateUpdate(oldState, newState);
  } catch (error) {
    triggerErrorEmbed(
      error,
      newState.client?.user?.username,
      newState.client?.user?.displayAvatarURL(),
    );
  }
}

