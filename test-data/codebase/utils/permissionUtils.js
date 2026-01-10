import { UserFlagsBitField } from 'discord.js';
import WhiteList from '../whitelist.json' with { type: 'json' };

const isOwnerOrBypassed = (id) => WhiteList.OwnerByPass.includes(id);
const isAuthorized = (id, a = []) => a.includes(id) || isOwnerOrBypassed(id);
const isBotWhitelisted = (id) => WhiteList.WhitelistedBots.includes(id);

const isBotVerified = async (botId, client) => {
  try {
    if (!client || !botId) return false;
    const user = await client.users.fetch(botId).catch(() => null);
    return (
      user && user.flags && user.flags.has(UserFlagsBitField.Flags.VerifiedBot)
    );
  } catch {
    return false;
  }
};

const isBotTrusted = async (botId, client = null) => {
  if (isBotWhitelisted(botId)) return true;

  return await isBotVerified(botId, client);
};

export {
  isAuthorized,
  isBotTrusted,
  isBotVerified,
  isBotWhitelisted,
  isOwnerOrBypassed,
};

