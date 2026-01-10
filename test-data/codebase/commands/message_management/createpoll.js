import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { embedColor } from '../../config/config.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function createpoll(message, language = 'fr', phrase) {
  try {
    const embed = {
      fr: {
        title: `📊 Sondage`,
        description: `\`\`\`\n${phrase} \n\`\`\`

				> Pour voter, utilisez les boutons ci-dessous.
				> Les résultats seront mis à jour en temps réel.`,
        fields: [
          {
            name: 'Oui',
            value: 'Personne',
            inline: true,
          },
          {
            name: 'Non',
            value: 'Personne',
            inline: true,
          },
        ],
        color: embedColor,
        footer: {
          text: `Sondage créé par ${message.author.username}`,
        },
        timestamp: new Date(),
      },
      en: {
        title: `📊 Poll`,
        description: `\`\`\`\n${phrase} \n\`\`\`

				> To vote, use the buttons below.
				> The results will be updated in real time.`,
        fields: [
          {
            name: 'Yes',
            value: 'Nobody',
            inline: true,
          },
          {
            name: 'No',
            value: 'Nobody',
            inline: true,
          },
        ],
        color: embedColor,
        footer: {
          text: `Poll created by ${message.author.username}`,
        },
        timestamp: new Date(),
      },
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poll_pour_${language}`)
        .setLabel(language === 'fr' ? 'Oui' : 'Yes')
        .setStyle(ButtonStyle.Success)
        .setEmoji({ id: '1304519561814741063' }),

      new ButtonBuilder()
        .setCustomId(`poll_contre_${language}`)
        .setLabel(language === 'fr' ? 'Non' : 'No')
        .setStyle(ButtonStyle.Danger)
        .setEmoji({ id: '1304519593083011093' }),
    );
    await message.channel.send({
      embeds: [embed[language]],
      components: [row],
    });
    if (!message.deleted) {
      await message.delete();
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { createpoll };

