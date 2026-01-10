import { EmbedBuilder } from 'discord.js';
import { embedColor } from '../../config/config.js';
import { fetchGuildFromShards, getAllGuilds } from '../guildUtils.js';
import triggerErrorEmbed from '../triggerErrorEmbed.js';

export default async function handleServerInfoCommand(m) {
  const args = m.content.split(' '),
    serverId = args[1]?.trim();
  let guild = null;
  if (serverId && args[0]?.startsWith('.serverinfo')) {
    const allGuilds = await getAllGuilds(m.client);
    const guildInfo = allGuilds.find((g) => g.id === serverId);

    if (guildInfo) {
      const guildData = await fetchGuildFromShards(m.client, serverId);
      if (guildData) {
        const createdAt = `<t:${Math.floor(guildData.createdTimestamp / 1000)}:D>`;
        const ownerMention =
          guildData.ownerId ? `<@${guildData.ownerId}>` : 'Inconnu';

        const embed = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle(guildData.name)
          .setThumbnail(guildData.iconURL)
          .addFields(
            {
              name: '👑 Propriétaire',
              value: ownerMention,
              inline: true,
            },
            {
              name: '👥 Membres',
              value: `${guildData.memberCount}`,
              inline: true,
            },
            {
              name: '📆 Créé le',
              value: createdAt,
              inline: true,
            },
            {
              name: '💬 Salons',
              value: `📝 ${guildData.textChannels} • 🔊 ${guildData.voiceChannels}`,
              inline: true,
            },
            {
              name: '🚀 Boost',
              value: `Niveau ${guildData.premiumTier}`,
              inline: true,
            },
            {
              name: '🆔 ID',
              value: guildData.id,
              inline: true,
            },
          )
          .setFooter({
            text: `Demandé par ${m.author.tag}`,
          });
        return await m.channel.send({
          embeds: [embed],
        });
      }
    }

    guild = null;
  } else {
    guild = m.guild;
  }

  if (!guild)
    return m.reply(
      serverId ?
        "Serveur introuvable. Vérifiez l'ID du serveur."
      : 'Cette commande doit être utilisée dans un serveur ou avec un ID de serveur valide.',
    );

  try {
    await guild.fetch();
    const totalMembers = guild.memberCount;
    const textChannels = guild.channels.cache.filter((c) => c.type === 0).size;
    const voiceChannels = guild.channels.cache.filter((c) => c.type === 2).size;
    const boostLevel = guild.premiumTier;
    const createdAt = `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`;
    const owner = await guild.fetchOwner().catch(() => null);
    const ownerValue = owner ? `<@${owner.id}>` : 'Inconnu';

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(guild.name)
      .setThumbnail(
        guild.iconURL({
          dynamic: true,
          size: 256,
        }),
      )
      .addFields(
        {
          name: '👑 Propriétaire',
          value: ownerValue,
          inline: true,
        },
        {
          name: '👥 Membres',
          value: `${totalMembers}`,
          inline: true,
        },
        {
          name: '📆 Créé le',
          value: createdAt,
          inline: true,
        },
        {
          name: '💬 Salons',
          value: `📝 ${textChannels} • 🔊 ${voiceChannels}`,
          inline: true,
        },
        {
          name: '🚀 Boost',
          value: `Niveau ${boostLevel}`,
          inline: true,
        },
        {
          name: '🆔 ID',
          value: guild.id,
          inline: true,
        },
      )
      .setFooter({
        text: `Demandé par ${m.author.tag}`,
      });
    await m.channel.send({
      embeds: [embed],
    });
  } catch (error) {
    triggerErrorEmbed(error, {
      userId: m.author?.id,
      source: 'handleServerInfoCommand.js',
      action: 'serverInfo',
      guildId: guild?.id,
    });
  }
}

