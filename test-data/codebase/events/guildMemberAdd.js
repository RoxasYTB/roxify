import { Events } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../config/config.js';
import translations from '../translations.json' with { type: 'json' };
import { decode, encode } from '../utils/3y3.js';
import { isBotWhitelisted } from '../utils/antiRaidCoordinator.js';
import { checkShards } from '../utils/checkShards.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';
import WhiteList from '../whitelist.json' with { type: 'json' };

const invitesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../invites.json',
);

async function updateGuildNameInInvites(guild) {
  let invites = {};
  try {
    if (fs.existsSync(invitesPath)) {
      const raw = await fs.promises.readFile(invitesPath, 'utf8');
      if (raw && raw.trim().length > 0) invites = JSON.parse(raw);
    }
  } catch {}
  if (!invites[guild.id]) invites[guild.id] = {};
  invites[guild.id].name = guild.name;
  try {
    await fs.promises.writeFile(invitesPath, JSON.stringify(invites, null, 2));
  } catch {}
}

export const name = Events.GuildMemberAdd;
export async function execute(member, shardId) {
  if (member.guild && shouldPauseGuild(member.guild.id)) {
    return;
  }
  if (!checkShards(member, shardId)) return;

  if (member.user.bot && member.user.username.toLowerCase().includes('pɪv')) {
    if (await isBotWhitelisted(member.id, member.client)) {
      return;
    }
    return await member.ban({
      reason: "Bannissement d'un bot de raid à l'entrée - nom contenant 'pɪv'",
    });
  }

  if (member.user.bot) return;

  if (
    ['1306682525812527184'].includes(member.id) ||
    member.user.username === 'Smashinator'
  ) {
    if (await isBotWhitelisted(member.id, member.client)) {
      return;
    }
    return await member.ban({
      reason: "Bot de raid banni à l'entrée.",
    });
  }

  if (member.id === '1349486051709685850') {
    return await member.ban({
      reason: "Bot spécifique banni à l'entrée.",
    });
  }

  const channels = await member.guild.channels.fetch();
  const autoroleChannel = channels.find(
    (c) => c.type === 0 && c.topic?.includes(encode('autorole')),
  );
  if (autoroleChannel) {
    const roleId = decode(autoroleChannel.topic).split('_')[1];
    const role = member.guild.roles.cache.get(roleId);
    if (role) {
      try {
        await member.roles.add(role);
      } catch {
        console.error(
          `Failed to add role ${role.name} to member ${member.user.tag} in guild ${member.guild.name}`,
        );
      }
    }
  }
  const joinChannel = channels.find(
    (c) => c.type === 0 && c.topic?.includes(encode('join')),
  );
  if (joinChannel) {
    const lang = 'fr',
      { memberCount } = member.guild,
      t = translations[lang],
      isOwner = WhiteList.OwnerByPass.includes(member.user.id);
    const username = isOwner ? t.specialMemberJoinMessage : t.memberJoinMessage;
    try {
      await joinChannel.send({
        embeds: [
          {
            color: embedColor,
            title:
              isOwner ?
                t.specialMemberTitle
              : t.welcomeTitle.replace('{userId}', member.user.id),
            description:
              isOwner ?
                t.specialMemberDescription.replace('{userId}', member.user.id)
              : t.welcomeDescription.replace('{userId}', member.user.id),
            image: {
              url: `attachment://welcome.png`,
            },
          },
        ],
        files: [
          {
            attachment: `http://localhost:9873/welcome/${lang}/${memberCount}/${encodeURIComponent(member.user.username)}%20${encodeURIComponent(username)}/${member.user.id}/${member.user.avatar}`,
            name: 'welcome.png',
          },
        ],
      });
    } catch {
      try {
        await joinChannel.send(`Bienvenue ${member.user}, ${username}!`);
      } catch {}
    }
  }

  await updateGuildNameInInvites(member.guild);
}

