import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEmbeddedContent } from '../../locales.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function createcandidature(message, language = 'fr') {
  try {
    const embeds = getEmbeddedContent('candidatures', 'candidature', language);
    if (!embeds) {
      if (!message.deleted) {
        try {
          return message.channel.send({
            content:
              'Error: Could not load candidature template for this language.',
          });
        } catch (error) {
          if (error.code !== 10008 && error.code !== 50035) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
      return;
    }

    embeds[0].image = {
      url: `attachment://rules.webp`,
    };
    await message.channel.send({
      embeds,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`create_candidature_${language}`)
            .setLabel(language === 'fr' ? 'Postuler' : 'Apply')
            .setStyle(ButtonStyle.Primary)
            .setEmoji({ id: '1269193840154378240', animated: true }),
        ),
      ],
      files: [
        {
          attachment: `http://localhost:9871/captcha/Candidature`,
          name: 'rules.webp',
        },
      ],
    });

    if (!message.deleted) {
      await message.delete();
    }
  } catch (e) {
    triggerErrorEmbed(e, {
      action: 'createcandidature',
      step: 'system_creation',
      component: 'createcandidature',
    });
    triggerErrorEmbed(
      e,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { createcandidature };

