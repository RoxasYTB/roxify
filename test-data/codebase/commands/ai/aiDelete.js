import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function aiDelete(interaction, { blacklist }) {
  if (blacklist.includes(interaction.user.id)) {
    return interaction.reply({
      content: "Vous n'êtes pas autorisé à utiliser ce bot.",
      ephemeral: true,
    });
  }

  let whitelist = [];
  try {
    const wlPath = path.join(__dirname, '..', '..', 'whitelist.json');
    if (fs.existsSync(wlPath)) {
      const wl = JSON.parse(fs.readFileSync(wlPath, 'utf8'));
      whitelist = wl.OwnerByPass || [];
    }
  } catch (err) {
    console.error('Erreur lecture whitelist:', err);
  }

  if (!whitelist.includes(interaction.user.id)) {
    return interaction.reply({
      content: "Vous n'êtes pas autorisé à utiliser cette commande.",
      ephemeral: true,
    });
  }

  const msg = interaction.targetMessage;
  const firstMessage = await interaction.reply({
    content: 'Suppression du message en cours...',
    ephemeral: true,
  });

  try {
    await msg.delete();
    firstMessage.delete();
  } catch (error) {
    console.error('Erreur lors de la suppression du message:', error);
    await interaction.reply({
      content: 'Échec de la suppression du message.',
      ephemeral: true,
    });
  }
}

