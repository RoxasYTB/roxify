import { EmbedBuilder, MessageFlags } from 'discord.js';
import { embedColor } from '../../config/config.js';
import { t } from '../../locales.js';
import { encode } from '../../utils/3y3.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

const TIME_UNITS = {
  y: 31536000000,
  M: 2592000000,
  w: 604800000,
  d: 86400000,
  h: 3600000,
  m: 60000,
  s: 1000,
};
const parseDuration = (d) =>
  Array.from(d.matchAll(/(\d+)([yMwdhms])/g)).reduce(
    (a, [, v, u]) => a + (TIME_UNITS[u] || 0) * parseInt(v, 10),
    0,
  );
async function creategiveaway(
  message,
  language = 'fr',
  duration,
  reward,
  winnersCount,
) {
  try {
    language = 'fr';
    const durationMs = parseDuration(duration);
    if (!durationMs)
      return message.reply({
        content: t('commands.giveaway.invalidDuration', language),
        flags: MessageFlags.Ephemeral,
      });
    const endTimestamp = Math.floor((Date.now() + durationMs) / 1000);
    const embed = new EmbedBuilder()
      .setTitle(t('commands.giveaway.title', language))
      .setDescription(
        `\`\`\`\n${reward} \n\`\`\`\n\n> ${t('commands.giveaway.participate', language)} \n> ${t('commands.giveaway.drawTime', language)} <t:${endTimestamp}:R>.`,
      )
      .addFields({
        name: t('commands.giveaway.participants', language),
        value: String(winnersCount),
        inline: true,
      })
      .setColor(embedColor)
      .setFooter({
        text:
          t('commands.giveaway.createdBy', language) + message.author.username,
      });
    const giveawayMessage = await message.channel.send({
      content: encode(`giveaway_started_${durationMs}_${winnersCount}`),
      embeds: [embed],
    });
    await Promise.all([
      giveawayMessage.react('🎉'),
      !message.deleted ? message.delete() : undefined,
      message.channel.setTopic(encode(`giveaway_${language}`)),
    ]);
    message.reply(t('commands.giveaway.created', language));
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}
export { creategiveaway };

