import { embedColor } from '../../config/config.js';
import WhiteList from '../../whitelist.json' with { type: 'json' };
import RSAPublicKeys from '../RSAPublicKeys.json' with { type: 'json' };

export default async function getRSAKeys(m) {
  if (WhiteList.KeysOwners.includes(m.author.id)) {
    const descriptions = [];

    for (const [version, key] of RSAPublicKeys) {
      descriptions.push(
        `- **${version} :**\n\`\`\`${key.replace(/\n/g, '\\n')}\`\`\``,
      );
    }

    const blocks = [];
    for (let i = 0; i < descriptions.length; i += 4) {
      const block = descriptions.slice(i, i + 4).join('\n');
      blocks.push(block);
    }

    const embeds = [];
    blocks.forEach((block) => {
      const embed = {
        color: embedColor,
        title: `Clés publiques RSA`,
        description: block,
      };
      embeds.push(embed);
    });

    for (let i = 0; i < embeds.length; i += 5) {
      await m.channel.send({
        embeds: embeds.slice(i, i + 5),
      });
    }
  } else {
    return m.reply(
      "Vous n'avez pas les permissions, cela ne vous regarde pas.",
    );
  }
}

