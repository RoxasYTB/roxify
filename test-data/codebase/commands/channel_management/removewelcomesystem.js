import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { embedColor } from '../../config/config.js';
import { t } from '../../locales.js';
import { encode } from '../../utils/3y3.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

export const removewelcomesystem = async (m, l = 'fr') => {
  try {
    const channels = m.guild.channels.cache;

    const welcomeChannels = channels.filter(
      (c) =>
        c.type === 0 &&
        c.topic &&
        (c.topic.includes(encode('join_')) ||
          c.topic.includes(encode('leave_'))),
    );

    if (welcomeChannels.size === 0) {
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(t('commands.removewelcome.no_system_title', l))
        .setDescription(t('commands.removewelcome.no_system_description', l));

      await m.channel.send({ embeds: [embed] });
      return;
    }

    const channelsList = welcomeChannels
      .map((c) => {
        const isJoin = c.topic.includes(encode('join_'));
        const type =
          isJoin ?
            t('commands.removewelcome.welcome_type', l)
          : t('commands.removewelcome.leave_type', l);
        return `• <#${c.id}> - ${type}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(t('commands.removewelcome.confirmation_title', l))
      .setDescription(
        `${t('commands.removewelcome.confirmation_description', l)}\n\n` +
          `${channelsList}\n\n` +
          `${t('commands.removewelcome.confirmation_warning', l)}`,
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`removewelcome_confirm_${l}`)
        .setLabel(t('commands.removewelcome.confirm_button', l))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`removewelcome_cancel_${l}`)
        .setLabel(t('commands.removewelcome.cancel_button', l))
        .setStyle(ButtonStyle.Secondary),
    );

    await m.channel.send({
      embeds: [embed],
      components: [row],
    });
  } catch (e) {
    triggerErrorEmbed(
      e,
      m.client?.user?.username,
      m.client?.user?.displayAvatarURL(),
    );
  }
};

