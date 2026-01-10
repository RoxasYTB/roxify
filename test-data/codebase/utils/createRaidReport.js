import { EmbedBuilder } from 'discord.js';
import { embedColor } from '../config/config.js';

async function createRaidReport(guild, title, options = {}) {
  try {
    const {
      description = 'Une activité de raid a été détectée et automatiquement contrée.',
      color = embedColor,
      fields = [],
      thumbnail = null,
      image = null,
      timestamp = true,
    } = options;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color);

    if (thumbnail) {
      embed.setThumbnail(thumbnail);
    } else {
      embed.setThumbnail(guild.iconURL());
    }

    if (image) {
      embed.setImage(image);
    }

    if (timestamp) {
      embed.setTimestamp();
    }

    let inviteUrl = 'Aucune invitation disponible';

    const inviteChannel = guild.channels.cache.find(
      (c) =>
        c.type === 0 &&
        c
          .permissionsFor(guild.members.me)
          ?.has(['ViewChannel', 'CreateInstantInvite']),
    );

    if (inviteChannel) {
      const invite = await inviteChannel.createInvite({
        maxAge: 86400,
        maxUses: 1,
        unique: true,
        reason: 'Invitation pour rapport de raid',
      });
      inviteUrl = invite.url;
    }

    embed.addFields(
      {
        name: '🏰 Serveur',
        value: guild.name,
        inline: true,
      },
      {
        name: '🆔 ID',
        value: guild.id,
        inline: true,
      },
      {
        name: '👥 Membres',
        value: guild.memberCount.toString(),
        inline: true,
      },
    );

    embed.addFields(
      {
        name: '👑 Propriétaire',
        value: `<@${guild.ownerId}>`,
        inline: true,
      },
      {
        name: '🔗 Invitation',
        value: inviteUrl,
        inline: true,
      },
      {
        name: '📅 Créé le',
        value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
        inline: true,
      },
    );

    if (fields && fields.length > 0) {
      embed.addFields(fields);
    }

    embed.setFooter({
      text: `GLaDOS Protection System • ${new Date().toLocaleString('fr-FR')}`,
      iconURL: guild.client.user.displayAvatarURL(),
    });

    return embed;
  } catch (error) {
    const fallbackEmbed = new EmbedBuilder()
      .setTitle('⚠️ Erreur Rapport de Raid')
      .setDescription(
        `Une erreur est survenue lors de la création du rapport pour le serveur ${guild.name}`,
      )
      .setColor(0xffaa00)
      .addFields(
        {
          name: '🏰 Serveur',
          value: guild.name,
          inline: true,
        },
        {
          name: '🆔 ID',
          value: guild.id,
          inline: true,
        },
        {
          name: '<:false:1304519593083011093> Erreur',
          value: error.message.substring(0, 100),
          inline: true,
        },
      )
      .setTimestamp()
      .setFooter({
        text: "GLaDOS Protection System - Rapport d'erreur",
        iconURL: guild.client.user.displayAvatarURL(),
      });

    return fallbackEmbed;
  }
}

export { createRaidReport };

