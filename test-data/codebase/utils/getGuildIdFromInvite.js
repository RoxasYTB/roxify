import { cacheGet, cacheSet } from './coreUtils.js';

async function getGuildIdFromInvite(invite) {
  const inviteCode = invite.split('/').pop();
  const cacheKey = `invite_guild_${inviteCode}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const response = await fetch(
    `https://discord.com/api/v9/invites/${inviteCode}?with_counts=true`,
  );
  if (!response.ok) throw new Error('Failed to fetch invite information');
  const data = await response.json();
  const guildId = data.guild.id;
  cacheSet(cacheKey, guildId, 3600000);
  return guildId;
}

export { getGuildIdFromInvite };

