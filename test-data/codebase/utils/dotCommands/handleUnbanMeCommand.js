import { getAllGuilds } from '../guildUtils.js';

export default async function handleUnbanMeCommand(m) {
  const args = m.content.split(' ');
  if (args.length !== 2) return m.reply('Usage: .unbanme <serverID>');

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
        const bans = await guild.bans.fetch();
        const userBan = bans.find((ban) => ban.user.id === userId);

        if (!userBan) {
          return m.reply("Vous n'êtes pas banni de ce serveur.");
        }

        await guild.members.unban(userId);
        result = { success: true, guildName: guild.name };
      } catch (error) {
        return m.reply(`Erreur lors du déban: ${error.message}`);
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
              const bans = await guild.bans.fetch();
              const userBan = bans.find((ban) => ban.user.id === userId);

              if (!userBan) {
                return {
                  found: true,
                  success: false,
                  message: "Vous n'êtes pas banni de ce serveur.",
                };
              }

              await guild.members.unban(userId);
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

    m.reply(`Vous avez été débanni du serveur: ${result.guildName}`);
  } catch (error) {
    m.reply(`Erreur lors du déban: ${error.message}`);
  }
}

