import { getAllGuilds } from '../guildUtils.js';
import triggerErrorEmbed from '../triggerErrorEmbed.js';

export default async function handleLeaveCommand(m) {
  const serverId = m.content.slice('.leave '.length).trim();

  if (!serverId || !/^[0-9]{17,20}$/.test(serverId)) {
    return m.reply(
      'Usage: `.leave <serverId>`\nVeuillez fournir un ID de serveur valide.',
    );
  }

  try {
    const allGuilds = await getAllGuilds(m.client);
    const guildInfo = allGuilds.find((g) => g.id === serverId);

    if (!guildInfo) {
      return m.reply(
        "Serveur introuvable. Vérifiez l'ID du serveur ou je ne suis peut-être pas sur ce serveur.",
      );
    }

    if (m.client.shard && typeof m.client.shard.broadcastEval === 'function') {
      const results = await m.client.shard.broadcastEval(
        async (client, { serverId }) => {
          const guild = client.guilds.cache.get(serverId);
          if (!guild) return { found: false };

          try {
            const guildName = guild.name;
            await guild.leave();
            return {
              found: true,
              success: true,
              guildName,
              shardId: client.shard?.ids?.[0] || 'unknown',
            };
          } catch (error) {
            return {
              found: true,
              success: false,
              error: error.message,
              shardId: client.shard?.ids?.[0] || 'unknown',
            };
          }
        },
        { context: { serverId } },
      );

      const result = results.find((r) => r.found);

      if (!result) {
        return m.reply(
          'Serveur introuvable sur aucun shard. Il se peut que je ne sois plus sur ce serveur.',
        );
      }

      if (result.success) {
        await m.reply(
          `J'ai quitté le serveur: **${result.guildName}** (${serverId})`,
        );
      } else {
        await m.reply(
          `Erreur lors de la tentative de quitter le serveur: ${result.error}`,
        );
      }
    } else {
      const guild = await m.client.guilds.fetch(serverId).catch(() => null);

      if (!guild) {
        return m.reply(
          "Serveur introuvable sur ce shard. Vérifiez l'ID du serveur.",
        );
      }

      try {
        const guildName = guild.name;
        await guild.leave();
        await m.reply(`J'ai quitté le serveur: **${guildName}** (${serverId})`);
      } catch (error) {
        await m.reply(
          `Une erreur s'est produite lors de la tentative de quitter le serveur: ${error.message}`,
        );
      }
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleLeaveCommand',
      action: 'leave_guild',
      guildId: serverId,
    });

    await m.reply(
      "Une erreur s'est produite lors de la tentative de quitter le serveur.",
    );
  }
}

