import { EmbedBuilder } from 'discord.js';
import { embedColor } from '../config/config.js';

async function sendStandardEmbed(channel, description, options = {}) {
  try {
    const {
      color = embedColor,
      title = '',
      fields = [],
      image = null,
      footer = null,
      attachments = [],
      components = [],
      allowedMentions = {
        parse: [],
      },
    } = options;

    const embed = new EmbedBuilder().setColor(color);
    if (description && description.trim().length > 0) {
      embed.setDescription(description);
    }

    if (title) embed.setTitle(title);
    if (fields.length) embed.addFields(fields);
    if (image) embed.setImage(image);
    if (footer) embed.setFooter(footer);

    return channel
      .send({
        embeds: [embed],
        files: attachments,
        components,
        allowedMentions,
      })
      .catch(() => null);
  } catch (error) {
    console.error('Error sending standard embed:', error);
    return null;
  }
}
async function sendWarningEmbed(channel, description, imageType) {
  const imageUrl = `http://localhost:9871/captcha-reverse/${imageType}`;

  let color = embedColor;
  if (imageType === 'Anti-Swear') {
    color = 0xffd700;
  }

  return sendStandardEmbed(channel, description, {
    color: color,
    attachments: [
      {
        attachment: imageUrl,
        name: imageType === 'Anti-Swear' ? 'anti-swear.png' : 'raid.png',
      },
    ],
    image:
      imageType === 'Anti-Swear' ?
        'attachment://anti-swear.png'
      : 'attachment://raid.png',
  });
}

function detectPotentialPhishing(content) {
  const visibleTextPattern = /\[[^\]]*\]\((http[^\s)]+)\)/gi;
  const cleanedContent = content.replace(/[^a-zA-Z0-9:/.\s[\]()]/g, '');

  const lowerContent = content.toLowerCase();
  const suspiciousTerms =
    (lowerContent.includes('$') || lowerContent.includes('gift')) &&
    lowerContent.includes('http');

  if (
    lowerContent.includes('https://cdn.discordapp.com/') ||
    lowerContent.includes('https://media.discordapp.net/stickers/') ||
    lowerContent.includes('https://cdn.discordapp.com/emojis/')
  ) {
    return false;
  }

  return (
    [...cleanedContent.matchAll(visibleTextPattern)].length > 0 ||
    suspiciousTerms
  );
}

export { detectPotentialPhishing, sendStandardEmbed, sendWarningEmbed };

