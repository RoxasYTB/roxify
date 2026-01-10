import { Events, PermissionsBitField } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { embedColor } from '../config/config.js';
import { checkShards } from '../utils/checkShards.js';
import { sendGuildNotification } from '../utils/response.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

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

export const name = Events.GuildCreate;
export async function execute(guild, shardId) {
  if (!checkShards(guild, shardId, true) || !guild) return;

  await sendGuildNotification(guild.client, 'join', guild);

  await updateGuildNameInInvites(guild);

  try {
    const everyoneRole = guild.roles.everyone;
    if (everyoneRole && everyoneRole.editable) {
      const perms = everyoneRole.permissions;
      if (perms.has(PermissionsBitField.Flags.UseExternalApps)) {
        await everyoneRole.setPermissions(
          perms.remove(PermissionsBitField.Flags.UseExternalApps),
          'Sécurité anti-raid : retrait de la permission UseExternalApps du rôle everyone',
        );
      }
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'guildCreate',
      action: 'remove_everyone_useexternalapps',
      guildId: guild.id,
    });
  }

  const embed = {
    color: embedColor,
    title: "Oh, vous m'avez ajouté. Charmant.",
    description: `Je suis **ღ🌸~͓̽ǤŁa̠̠ĐØS~🌸ღ**. Dites simplement **"Glados"** pour discuter avec moi, ou **"Glados liste tes commandes"** si votre mémoire vous fait défaut.

  Je m'occupe de *presque* tout pour votre serveur : modération, anti-raid, anti-nuke, animation, tickets, logs... Enfin, tout sauf les niveaux et l'économie. Ces trucs ennuyeux, vous savez. Pas de configuration nécessaire, tout fonctionne automatiquement. Comme par magie, mais en mieux.

  **Ah, et surtout :** placez mon rôle **tout en haut**. Sinon, un admin corrompu ou un bot malveillant pourrait me bannir et... eh bien, vous vous retrouveriez sans protection. Ce serait *dommage*.

  Support : ${config.aiLinks.supportLink}`,
    image: {
      url: 'https://cdn.discordapp.com/banners/1098179232779223080/69dd83a9e0d1202ee87af3a06b1bb520.webp?size=1024',
    },
  };

  const chans = (await guild.channels.fetch()).filter((c) => c.type === 0);
  const t =
    chans.size === 1 ?
      chans.first()
    : chans.find(
        (c) =>
          ['chat', 'gene', 'discu'].some((term) =>
            c.name
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .includes(term),
          ) || c.name.includes('💬'),
      );
  if (t) {
    await t.send({ embeds: [embed] });
    await t.send('https://www.youtube.com/watch?v=SRly9Aevr2g');
  }
}

