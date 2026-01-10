import { getClosestChannel } from '../../utils/findClosestMatch.js';

export const setroomduration = async (m, n, d) => {
  const c = getClosestChannel(m.guild, n);
  if (c) await c.setRateLimitPerUser(d / 1000);
};

