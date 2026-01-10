import { exec } from 'child_process';
import { EmbedBuilder } from 'discord.js';

export default async (m) => {
  const embed = new EmbedBuilder()
    .setDescription('🔄 Redémarrage de la version vocale en cours...')
    .setColor(0xffd700);

  const sent = await m.reply({ embeds: [embed] });

  exec('pm2 restart 5', async (error, stdout, stderr) => {
    let newEmbed = EmbedBuilder.from(embed);

    if (error) {
      newEmbed.setDescription(
        `❌ Erreur lors du redémarrage :\n\`${error.message}\``,
      );
    } else if (stderr) {
      newEmbed.setDescription(`⚠️ Erreur :\n\`${stderr}\``);
    } else {
      newEmbed.setDescription(
        '✅ Redémarrage de la version vocale effectué avec succès !',
      );
    }

    await sent.edit({ embeds: [newEmbed] });
  });
};

