import { createlounge } from './createlounge.js';

export const createvocal = async (m, n, p, perms = null) => {
  await m.guild.channels.fetch();
  if (!m.guild.channels.cache.find((c) => c.name === n))
    await createlounge(m, n, 2, p, perms);
};

