import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getEmbeddedContent, t } from '../../locales.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function createticketsystem(message, language = 'fr') {
  try {
    let embeds = getEmbeddedContent('tickets', 'tickets', language);
    if (!embeds) {
      return message.reply({
        content: 'Error: Could not load ticket template for this language.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const imageUrl = `http://localhost:9871/captcha-reverse/tickets`;
    const imageAttachment = {
      attachment: imageUrl,
      name: 'commands.webp',
    };

    if (!Array.isArray(embeds)) {
      embeds = [embeds];
    }

    if (embeds.length > 0) {
      embeds[0].image = {
        url: 'attachment://commands.webp',
      };
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`open_ticket_${language}`)
        .setLabel(t('tickets.openLabel', language) || 'Ouvrir un ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji({ id: '1269193818302054430', animated: true }),
    );

    await message.channel.send({
      embeds,
      files: [imageAttachment],
      components: [row],
    });
    if (message.deletable && !message.deleted) {
      await message.delete();
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
    return;
  }
}

export { createticketsystem };

