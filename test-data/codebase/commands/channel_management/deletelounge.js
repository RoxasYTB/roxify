import { getClosestNameItem } from '../../utils/findClosestMatch.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function deletelounge(message, roomName) {
  const matchingChannels = message.guild.channels.cache.filter((ch) =>
    ch.name.toLowerCase().includes(roomName.toLowerCase()),
  );
  const closestMatch = getClosestNameItem(matchingChannels, roomName);

  if (closestMatch) {
    if (
      closestMatch.flags?.has('RequireTag') ||
      message.guild.rulesChannelId === closestMatch.id ||
      message.guild.publicUpdatesChannelId === closestMatch.id
    ) {
      return;
    }
    try {
      await closestMatch.delete(
        `Suppression via commande deletelounge par ${message.author.tag}`,
      );
    } catch (error) {
      if (error.code === 50074) {
        return;
      }
      triggerErrorEmbed(
        error,
        message.client?.user?.username,
        message.client?.user?.displayAvatarURL(),
      );
    }
  } else {
    for (const c of matchingChannels.values()) {
      if (
        c.flags?.has('RequireTag') ||
        message.guild.rulesChannelId === c.id ||
        message.guild.publicUpdatesChannelId === c.id
      ) {
        continue;
      }
      try {
        await c.delete(
          `Suppression via commande deletelounge par ${message.author.tag}`,
        );
      } catch (error) {
        if (error.code === 50074) {
          continue;
        }
        triggerErrorEmbed(
          error,
          message.client?.user?.username,
          message.client?.user?.displayAvatarURL(),
        );
      }
    }
  }
}
export { deletelounge };

