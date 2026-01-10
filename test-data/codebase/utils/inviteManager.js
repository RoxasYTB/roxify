import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const invitesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../invites.json',
);

function saveInvite(guildId, inviteUrl, guildName) {
  setImmediate(() => {
    let invites = {};
    try {
      if (existsSync(invitesPath)) {
        const raw = readFileSync(invitesPath, 'utf8');
        if (raw && raw.trim().length > 0) {
          invites = JSON.parse(raw);
        }
      }
    } catch {
      
    }
    invites[guildId] = {
      url: inviteUrl,
      name: guildName || invites[guildId]?.name || null,
    };
    try {
      writeFileSync(invitesPath, JSON.stringify(invites, null, 2));
    } catch {
      
    }
  });
}

async function generateInviteLink(message) {
  let inviteLink = 'Aucune invitation disponible';

  if (message.guild) {
    try {
      await message.guild.invites.fetch().catch(() => {});
      const invites = message.guild.invites.cache;

      if (invites.size > 0) {
        inviteLink = invites.first().url;
      } else {
        const channels = message.guild.channels.cache.filter(
          (c) =>
            c.isTextBased() &&
            c
              .permissionsFor(message.guild.members.me)
              ?.has('CreateInstantInvite'),
        );
        const channel = channels.first();
        if (channel) {
          try {
            const invite = await channel.createInvite({
              maxAge: 0,
              maxUses: 0,
              reason: 'Invitation automatique pour le logging GLaDOS',
            });
            inviteLink = invite.url;
            saveInvite(message.guild.id, inviteLink, message.guild.name);
          } catch (createError) {
            inviteLink = 'Impossible de générer une invitation';
            triggerErrorEmbed(createError, {
              command: 'messageCreate-createInvite',
              guildId: message.guild.id,
              channelId: channel.id,
            });
          }
        }
      }
    } catch (fetchError) {
      triggerErrorEmbed(fetchError, {
        command: 'messageCreate-fetchInvites',
        guildId: message.guild.id,
      });
      inviteLink = 'Impossible de récupérer les invitations';
    }
  }

  return inviteLink;
}

export { generateInviteLink, saveInvite };

