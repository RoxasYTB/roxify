import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';
import { embedColor } from '../../config/config.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';
const t = {
  fr: {
    title: '📢 Configuration du canal de création du vocal personnalisé',
    description:
      'Veuillez sélectionner le canal de création du vocal personnalisé à utiliser.',
  },
};

export const setupcreateownvoice = async (m, l = 'fr') => {
  try {
    const { title, description } = t[l];
    const menu = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`custom_voice_channel_${l}`)
        .setPlaceholder('Custom Voice Channel')
        .setChannelTypes(2),
    );
    await m.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(embedColor)
          .setTitle(title)
          .setDescription(description),
      ],
      components: [menu],
    });
  } catch (error) {
    triggerErrorEmbed(
      error,
      m.client?.user?.username,
      m.client?.user?.displayAvatarURL(),
    );
  }
};

