import { getClosestChannel } from '../../utils/findClosestMatch.js';

export const moveroom = async (m, r, c) => {
  const ch = getClosestChannel(m.guild, r);
  const cat = getClosestChannel(m.guild, c);
  if (ch && cat && cat.type === 4) await ch.setParent(cat.id);
};

