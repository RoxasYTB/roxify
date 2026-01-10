import { embedColor } from '../config/config.js';
import { t } from '../locales/index.js';
import { encode } from '../utils/3y3.js';

async function handleDeleteCandidature(interaction) {
  const name = interaction.channel.name;

  await interaction.channel.delete(
    `Candidature supprimée par ${interaction.user.tag} via interaction`,
  );

  const logChannel = interaction.guild.channels.cache.find(
    (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_candidatures')),
  );
  const language = interaction.customId.split('_').pop() || 'fr';
  const action = language === 'fr' ? 'supprimée' : 'deleted';

  if (logChannel) {
    await logChannel.send({
      embeds: [
        {
          color: embedColor,
          title: t('candidatures.logs.title', language, {
            action,
          }),
          description: t('candidatures.logs.description', language, {
            action,
          }),
          fields: [
            {
              name: t('candidatures.logs.candidatureName', language),
              value: `#${name}`,
              inline: true,
            },
            {
              name: language === 'fr' ? `${action} par:` : `${action} by:`,
              value: `<@${interaction.user.id}>`,
              inline: true,
            },
          ],
          timestamp: new Date(),
          footer: {
            text: t('candidatures.logs.footer', language),
          },
        },
      ],
    });
  }
}

export { handleDeleteCandidature };

