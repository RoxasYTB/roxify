import { exec } from 'child_process';
import fs from 'fs';
import { embedColor } from '../../config/config.js';

export default async function handleRestartCommand(m) {
  try {
    fs.writeFileSync(
      './temp_restart.json',
      JSON.stringify({
        channelId: m.channel.id,
        messageId: m.id,
      }),
    );

    const pm2Ids = ['1'];
    for (let i = 0; i < pm2Ids.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      exec(`pm2 restart ${pm2Ids[i]}`, async (error, stdout, stderr) => {
        if (error) {
          console.error(`Erreur lors du restart PM2 (${pm2Ids[i]}): ${error}`);
          return;
        }
        if (stderr) {
          console.error(`Stderr PM2 (${pm2Ids[i]}): ${stderr}`);
          return;
        }

        if (pm2Ids[i] === '0') {
          const embed = {
            color: embedColor,
            description: '🔄 **Redémarrage en cours...**',
            footer: {
              text: "Merci d'attendre quelques secondes, votre patience est précieuse.",
            },
          };
          const msg = await m.reply({
            embeds: [embed],
          });
          await m.delete();

          fs.writeFileSync(
            './temp_restart.json',
            JSON.stringify({
              channelId: m.channel.id,
              messageId: msg.id,
            }),
          );
        }
      });
    }
  } catch (error) {
    console.error('Error checking user permissions:', error);
    return;
  }
}

