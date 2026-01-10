import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function aiEdit(interaction, { blacklist, client }) {
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
  if (msg.author.id !== client.user.id) {
    const lambdaMessage = await interaction.reply({
      content: 'Vous ne pouvez pas modifier ce message.',
      ephemeral: true,
    });
    return lambdaMessage.delete();
  }

  try {
    const modal = new ModalBuilder()
      .setCustomId('aiEditModal')
      .setTitle('Éditez votre message')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('editInput')
            .setLabel('Nouveau contenu du message')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Écrivez ici le nouveau contenu du message.')
            .setValue(msg.content),
        ),
      );

    await interaction.showModal(modal);

    const modalSubmit = await interaction.awaitModalSubmit({
      filter: (i) =>
        i.customId === 'aiEditModal' && i.user.id === interaction.user.id,
      time: 60000,
    });
    const newContent = modalSubmit.fields.getTextInputValue('editInput');
    await msg.edit(newContent);
    const confirmation = await modalSubmit.reply({
      content: 'Message édité avec succès.',
      ephemeral: true,
    });
    confirmation.delete();
  } catch (error) {
    console.error("Erreur lors de l'édition du message:", error);
    await interaction.reply({
      content: "Échec de l'édition du message.",
      ephemeral: true,
    });
  }
}

