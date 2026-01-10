import { getClosestChannel } from '../../utils/findClosestMatch.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

export const renameroom = async (m, o, n) => {
  const c = getClosestChannel(m.guild, o);
  if (c)
    await c.setName(n).catch((error) => {
      triggerErrorEmbed(
        error,
        m.client?.user?.username,
        m.client?.user?.displayAvatarURL(),
      );
    });
};

