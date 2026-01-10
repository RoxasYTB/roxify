import { EmbedBuilder } from 'discord.js';
import '../whitelist.json' with { type: 'json' };
import { ChannelLogId } from './config/config.js';

const eventTypeResponse = {
  guildCreate: 'rejoint',
  guildDelete: 'quitté',
};

const createGuildEmbed = (client, guild, eventType, inviteUrl = null) =>
  new EmbedBuilder()
    .setColor(0xf7b300)
    .setTitle(
      `${client.user.username} a ${eventTypeResponse[eventType]} un serveur`,
    )
    .setThumbnail(guild.iconURL() || client.user.displayAvatarURL())
    .addFields([
      {
        name: 'Nom du serveur',
        value: inviteUrl ? `[${guild.name} ](${inviteUrl} )` : guild.name,
        inline: true,
      },
      {
        name: 'ID du serveur',
        value: guild.id,
        inline: true,
      },
      {
        name: 'Propriétaire du serveur',
        value: `<@${guild.ownerid}>`,
        inline: true,
      },
      {
        name: 'Nombre de membres',
        value: guild.memberCount.toString(),
        inline: true,
      },
      {
        name: 'Nombre de salons/catégories',
        value: guild.channels.cache.size.toString(),
        inline: true,
      },
    ])
    .setFooter({
      text: `Date de création : ${guild.createdAt.toLocaleDateString()}`,
    });

const sendGuildNotification = async (client, eventType, guild) => {
  let inviteUrl = null;
  if (eventType === 'guildCreate') {
    const guildChannel = (await guild.channels.fetch())
      .filter((e) => e.type !== 4)
      .first();
    inviteUrl =
      (await guild.invites.fetch()).first()?.url ||
      (guildChannel &&
        (
          await guildChannel.createInvite({
            maxAge: 0,
            maxUses: 0,
          })
        ).url);
  }
  const embed = createGuildEmbed(client, guild, eventType, inviteUrl);
  const channel = await client.channels.fetch(ChannelLogId);
  if (channel)
    await channel.send({
      embeds: [embed],
    });
};

export { sendGuildNotification };
export const NoDispoDM =
  'Les commandes ne sont pas disponibles dans les messages privés.';

