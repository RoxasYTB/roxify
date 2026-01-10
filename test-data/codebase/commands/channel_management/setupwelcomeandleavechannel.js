import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';

import { embedColor } from '../../config/config.js';
import { t } from '../../locales.js';
import { convertText } from '../../utils/fontConverter.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function showSelectionMenu(m, l, page = 0) {
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(t('commands.welcome.title', l))
    .setDescription(t('commands.welcome.description', l));

  const menu = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`welcome_channel_${l}_${page}`)
      .setPlaceholder(t('commands.welcome.placeholder', l))
      .setChannelTypes(0)
      .setMinValues(1)
      .setMaxValues(1),
  );

  await m.channel.send({
    embeds: [embed],
    components: [menu],
  });
}

export const setupwelcomeandleavechannel = async (m, l = 'fr') => {
  try {
    const welcomeKeywords = ['bienv', 'arriv', 'welcome', 'join'];
    const leaveKeywords = ['dép', 'depart', 'revo', 'leave', 'exit'];

    const channels = m.guild.channels.cache.filter((c) => c.type === 0);
    const welcomeChannels = channels.filter((c) =>
      welcomeKeywords.some((k) =>
        convertText(c.name, 'normal').toLowerCase().includes(k),
      ),
    );
    const leaveChannels = channels.filter((c) =>
      leaveKeywords.some((k) =>
        convertText(c.name, 'normal').toLowerCase().includes(k),
      ),
    );

    if (welcomeChannels.size || leaveChannels.size) {
      const welcomeId = welcomeChannels.first()?.id;
      const leaveId = leaveChannels.first()?.id;

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(t('commands.welcome.detection_title', l))
        .setDescription(
          `${t('commands.welcome.channels_detected', l)} \n\n` +
            `${welcomeId ? `${t('commands.welcome.welcome_channel', l)} : <#${welcomeId}>\n` : ''}` +
            `${leaveId ? `${t('commands.welcome.leave_channel', l)} : <#${leaveId}>` : ''} \n\n` +
            `${t('commands.welcome.detection_proceed', l)}`,
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`welcome_confirm_${welcomeId}_${leaveId}_${l}`)
          .setLabel(t('commands.welcome.confirm', l))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`welcome_continue_${l}`)
          .setLabel(t('commands.welcome.continue_setup', l))
          .setStyle(ButtonStyle.Danger),
      );

      await m.channel.send({
        embeds: [embed],
        components: [row],
      });
      return;
    }

    showSelectionMenu(m, l, 0);
  } catch (e) {
    triggerErrorEmbed(
      e,
      m.client?.user?.username,
      m.client?.user?.displayAvatarURL(),
    );
  }
};

