import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../../config/config.js';
import { t } from '../../locales.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WhiteList = JSON.parse(
  readFileSync(__dirname.split('commands')[0] + 'whitelist.json', 'utf8'),
);

async function shareannouncement(message, language = 'fr', topic = 'none') {
  try {
    let responseText = (
      await (
        await fetch('http://localhost:6259/glados-min', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question: t('commands.announcement.prompt', language, {
              topic,
            }),
          }),
        })
      ).json()
    ).response;

    responseText = responseText
      .replaceAll(/ღ🌸~͓̽ǤŁa̠̠ĐØS~🌸ღ|ღ~͓̽ǤŁa̠̠ĐØS~ღ/g, message.author.username)
      .replaceAll('ysannier_', 'Roxas')
      .replace(
        new RegExp(
          `(${message.author.username} |${WhiteList.BotName} ) : `,
          'g',
        ),
        '',
      )
      .replace(/, {2}/g, ', ')
      .replaceAll('omment origi', "comme c'est origi")
      .replace(/^\(\d{17,19}\) ?/, '');

    const embedAnnonce = {
      title: t('commands.announcement.title', language),
      description: t('commands.announcement.description', language),
      fields: responseText.match(/.{1,1024}/g).map((chunk, i) => ({
        name: i ? '' : t('commands.announcement.field', language),
        value: chunk,
        inline: false,
      })),
      color: embedColor,
      timestamp: new Date(),
    };

    await message.channel.send({
      embeds: [embedAnnonce],
    });
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { shareannouncement };

