import { getClosestChannel } from '../../utils/findClosestMatch.js';

export const syncpermissionswithcategory = async (m, n) => {
  const cat = getClosestChannel(m.guild, n);
  if (!cat || cat.type !== 4) return;
  const channels = Array.from(cat.children.cache.values());
  await Promise.allSettled(channels.map((ch) => ch.lockPermissions()));
};

