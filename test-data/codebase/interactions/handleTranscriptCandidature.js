import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../config/config.js';
import { encode } from '../utils/3y3.js';
import { transcriptChannel } from '../utils/transcriptChannel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function handleTranscriptCandidature(interaction) {
  const language = interaction.customId.split('_').pop() || 'fr';
  const localeFile = path.join(
    __dirname,
    '..',
    'locales',
    language,
    'candidatures.json',
  );

  let translations;
  try {
    translations = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
  } catch {
    translations = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'locales', 'fr', 'candidatures.json'),
        'utf8',
      ),
    );
  }
  const logChannel = interaction.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_candidatures')),
  );

  await interaction.update({
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`openagain_candid_${language}`)
          .setLabel(translations.buttons.reopen)
          .setStyle(ButtonStyle.Success)
          .setEmoji({ id: '1304519561814741063' }),

        new ButtonBuilder()
          .setCustomId(`delete_candid_${language}`)
          .setLabel(translations.buttons.delete)
          .setStyle(ButtonStyle.Danger)
          .setEmoji({ id: '1304519593083011093' }),
      ),
    ],
  });

  const { transcriptHTML } = await transcriptChannel(
    interaction.channel,
    interaction.user,
    language,
  );

  const action = language === 'fr' ? 'transcrite' : 'transcript';
  const actionText = translations.logs.title.replace('{action}', action);
  const logCandidTranscriptedEmbed = {
    color: embedColor,
    title: actionText,
    description: translations.logs.description.replace('{action}', action),
    fields: [
      {
        name: translations.logs.candidatureName,
        value: `#${interaction.channel.id}`,
        inline: true,
      },
      {
        name: translations.logs.transcribedBy,
        value: `<@${interaction.user.id}>`,
        inline: true,
      },
    ],
    timestamp: new Date(),
    footer: {
      text: translations.logs.footer,
    },
  };

  const logMessage = {
    embeds: [logCandidTranscriptedEmbed],
    files: [
      {
        attachment: Buffer.from(transcriptHTML),
        name: 'transcript.html',
      },
    ],
  };

  if (logChannel) {
    await logChannel.send(logMessage);
    await interaction.channel.send(
      language === 'fr' ?
        'Le transcript a été envoyée dans le salon de logs.'
      : 'The transcript has been sent to the logs channel.',
    );
  } else await interaction.channel.send(logMessage);
}

export { handleTranscriptCandidature };

