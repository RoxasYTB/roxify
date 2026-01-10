import { EmbedBuilder } from 'discord.js';
import { captchaBaseUrl, embedColor } from '../../config/config.js';
import { getClosestChannel } from '../../utils/findClosestMatch.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

export const purgeroom = async (m, n) => {
  const c = getClosestChannel(m.guild, n);
  if (!c) {
    return await m.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(embedColor)
          .setDescription(`Aucun canal trouvé avec le nom "${n}".`),
      ],
    });
  }
  try {
    const { type, parentId, name, permissionOverwrites, topic, position } = c;
    const perms = permissionOverwrites.cache.map(
      ({ id, allow, deny, type }) => ({
        id,
        allow,
        deny,
        type,
      }),
    );
    const newC = await m.guild.channels.create({
      name,
      type,
      parent: parentId,
      permissionOverwrites: perms,
      topic,
    });
    await newC.setPosition(position + 1);

    await c.delete(`Purge salon par ${m.author.tag}`);

    await newC.send({
      embeds: [
        new EmbedBuilder()
          .setColor(embedColor)
          .setDescription(
            `> Le salon ${n} a été purgé avec succès.\n> Vous pouvez maintenant parler dans le nouveau salon.`,
          )
          .setImage('attachment://purge.webp'),
      ],
      files: [
        {
          attachment: `${captchaBaseUrl}/captcha-reverse/Purge`,
          name: 'purge.webp',
        },
      ],
    });
  } catch (error) {
    if (error.code == 50074) {
      m.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(
              "Je n'ai pas pu supprimer ce salon à cause des règles Discord des serveurs communautaires. Regardez vos paramètres de salon `rules` et `moderator-only`.",
            ),
        ],
      });
      return;
    }

    triggerErrorEmbed(
      error,
      m.client?.user?.username,
      m.client?.user?.displayAvatarURL(),
    );

    m.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(embedColor)
          .setDescription(
            'Une erreur est survenue lors de la duplication du salon!',
          ),
      ],
    });
  }
};

