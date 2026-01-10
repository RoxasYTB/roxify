import { convertText } from '../fontConverter.js';
import triggerErrorEmbed from '../triggerErrorEmbed.js';

const searchGuildsByName = async (client, query) => {
  try {
    const normalizedQuery = convertText(query.toLowerCase(), 'normal');

    if (client.shard && typeof client.shard.broadcastEval === 'function') {
      const results = await client.shard.broadcastEval(
        async (c, { normalizedQuery }) => {
          const { convertText } = await import('./utils/fontConverter.js');

          const matchingGuilds = [];
          c.guilds.cache.forEach((guild) => {
            const guildName = convertText(guild.name.toLowerCase(), 'normal');
            if (guildName.includes(normalizedQuery)) {
              matchingGuilds.push({
                id: guild.id,
                name: guild.name,
              });
            }
          });

          return matchingGuilds;
        },
        { context: { normalizedQuery } },
      );

      const allMatches = results.flat();

      const uniqueMatches = allMatches.filter(
        (guild, index, self) =>
          index === self.findIndex((g) => g.id === guild.id),
      );

      return uniqueMatches;
    } else {
      const matchingGuilds = [];
      client.guilds.cache.forEach((guild) => {
        const guildName = convertText(guild.name.toLowerCase(), 'normal');
        if (guildName.includes(normalizedQuery)) {
          matchingGuilds.push({
            id: guild.id,
            name: guild.name,
          });
        }
      });

      return matchingGuilds;
    }
  } catch (e) {
    triggerErrorEmbed(e);
    return [];
  }
};
async function createInviteOnAnyShard(client, guildId) {
  try {
    const localGuild = client.guilds.cache.get(guildId);
    if (localGuild) {
      const channel = localGuild.channels.cache.find(
        (c) =>
          c.type === 0 &&
          c.permissionsFor(localGuild.members.me)?.has('CreateInstantInvite'),
      );
      if (channel) {
        const invite = await channel.createInvite({ maxAge: 0 });
        return invite.url;
      }
    }

    if (client.shard && typeof client.shard.broadcastEval === 'function') {
      const results = await client.shard.broadcastEval(
        async (c, { guildId }) => {
          const guild = c.guilds.cache.get(guildId);
          if (!guild) return null;

          const channel = guild.channels.cache.find(
            (ch) =>
              ch.type === 0 &&
              ch.permissionsFor(guild.members.me)?.has('CreateInstantInvite'),
          );

          if (channel) {
            try {
              const invite = await channel.createInvite({ maxAge: 0 });
              return invite.url;
            } catch {
              return null;
            }
          }
          return null;
        },
        { context: { guildId } },
      );

      const validResult = results.find((result) => result !== null);
      if (validResult) {
        return validResult;
      }
    }

    return null;
  } catch (error) {
    console.error(
      "Erreur lors de la création d'invitation multi-shard:",
      error,
    );
    return null;
  }
}

export default async function handleInviteCommand(m) {
  const q = m.content.slice('.invite '.length).trim();
  if (!q)
    return m.reply(
      "Usage: `.invite <serverId ou nomDuServeur>`\n- Utilisez l'ID du serveur pour une correspondance exacte\n- Utilisez au moins 2 caractères pour une recherche par nom",
    );
  try {
    if (/^[0-9]{17,20}$/.test(q)) {
      const inviteUrl = await createInviteOnAnyShard(m.client, q);
      if (inviteUrl) {
        await m.reply(inviteUrl);
        return;
      }

      await m.reply(
        "Serveur introuvable ou impossible de créer une invitation. Vérifiez que je suis sur ce serveur et que j'ai les permissions nécessaires.",
      );
      return;
    }

    if (q.length < 2) {
      return m.reply(
        'Veuillez entrer au moins 2 caractères pour rechercher un serveur par son nom.',
      );
    }

    const matchingGuilds = await searchGuildsByName(m.client, q);

    if (matchingGuilds.length === 0) {
      return m.reply(
        "Serveur introuvable. Vérifiez l'ID ou le nom du serveur.",
      );
    }

    if (matchingGuilds.length === 1) {
      const inviteUrl = await createInviteOnAnyShard(
        m.client,
        matchingGuilds[0].id,
      );
      if (inviteUrl) {
        await m.reply(inviteUrl);
        return;
      }
      await m.reply(
        'Aucun salon accessible trouvé sur ce serveur ou impossible de générer une invitation.',
      );
      return;
    }

    const invites = [];
    for (const guild of matchingGuilds.slice(0, 10)) {
      const inviteUrl = await createInviteOnAnyShard(m.client, guild.id);
      if (inviteUrl) {
        invites.push(`**${guild.name}** (${guild.id})\n${inviteUrl}`);
      } else {
        invites.push(
          `**${guild.name}** (${guild.id})\n*Impossible de créer une invitation*`,
        );
      }
    }

    if (invites.length === 0) {
      await m.reply(
        "Aucune invitation n'a pu être créée pour les serveurs trouvés.",
      );
      return;
    }

    let responseMessage = `**__*Plusieurs serveurs trouvés:*__**\n\n\n${invites.join('\n\n')}`;
    if (responseMessage.length > 2000) {
      await m.reply(
        `Beaucoup trop de serveurs correspondent à votre recherche (${matchingGuilds.length} serveurs trouvés).\nVeuillez utiliser un terme de recherche plus précis pour affiner les résultats.`,
      );
      return;
    }
    await m.reply(responseMessage);
  } catch (e) {
    triggerErrorEmbed(
      e,
      m.client?.user?.username,
      m.client?.user?.displayAvatarURL(),
    );
  }
}

