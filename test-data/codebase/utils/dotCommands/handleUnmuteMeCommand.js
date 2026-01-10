import { getAllGuilds } from '../guildUtils.js';

export default async function handleUnmuteMeCommand(m) {
  const args = m.content.split(' ');
  if (args.length !== 2) return m.reply('Usage: .unmuteme <serverID>');

  const serverId = args[1];
  const userId = m.author.id;

  const allGuilds = await getAllGuilds(m.client);
  const guildInfo = allGuilds.find((g) => g.id === serverId);

  if (!guildInfo) {
    return m.reply("Serveur introuvable. Vérifiez l'ID du serveur.");
  }

  try {
    let result = null;

    let guild = m.client.guilds.cache.get(serverId);
    if (guild) {
      try {
        const userToUnmute = await guild.members
          .fetch(userId)
          .catch(() => null);

        if (!userToUnmute) {
          return m.reply("Vous n'êtes pas membre de ce serveur.");
        }

        await userToUnmute.timeout(null);
        result = { success: true, guildName: guild.name };
      } catch (error) {
        return m.reply(`Erreur lors du démute: ${error.message}`);
      }
    } else if (
      m.client.shard &&
      typeof m.client.shard.broadcastEval === 'function'
    ) {
      try {
        const results = await m.client.shard.broadcastEval(
          async (c, { serverId, userId }) => {
            const guild = c.guilds.cache.get(serverId);
            if (!guild) return { found: false };

            try {
              const userToUnmute = await guild.members
                .fetch(userId)
                .catch(() => null);

              if (!userToUnmute) {
                return {
                  found: true,
                  success: false,
                  message: "Vous n'êtes pas membre de ce serveur.",
                };
              }

              await userToUnmute.timeout(null);
              return {
                found: true,
                success: true,
                guildName: guild.name,
              };
            } catch (error) {
              return {
                found: true,
                success: false,
                message: error.message,
              };
            }
          },
          { context: { serverId, userId } },
        );

        const validResult = results.find((r) => r.found);
        result = validResult || null;
      } catch {
        return m.reply('Erreur lors de la communication avec les shards.');
      }
    }

    if (!result || !result.success) {
      return m.reply(
        result?.message ||
          "Impossible d'accéder au serveur ou le serveur est introuvable.",
      );
    }

    m.reply(`Vous avez été démuté du serveur: ${result.guildName}`);
  } catch (error) {
    m.reply(`Erreur lors du démute: ${error.message}`);
  }
}

