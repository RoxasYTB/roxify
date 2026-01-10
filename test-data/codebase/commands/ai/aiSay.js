import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import fs from 'fs';
import path from 'path';

export default async function aiSay(interaction, { blacklist }) {
  if (blacklist.includes(interaction.user.id)) {
    return interaction.reply({
      content: "Vous n'êtes pas autorisé à utiliser ce bot.",
      ephemeral: true,
    });
  }

  let whitelist = [];
  try {
    const wlPath = path.join(process.cwd(), 'whitelist.json');
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

  if (!import.meta || !import.meta.url) {
  }
  try {
    const modal = new ModalBuilder()
      .setCustomId('aiResponseModal')
      .setTitle('Informations supplémentaires')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('questionInput')
            .setLabel('Question ou contexte supplémentaire')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Écris ce que tu veux que Glados dise.'),
        ),
      );

    await interaction.showModal(modal);

    const modalSubmit = await interaction.awaitModalSubmit({
      filter: (i) =>
        i.customId === 'aiResponseModal' && i.user.id === interaction.user.id,
      time: 60000,
    });

    const firstMessage = await modalSubmit.reply({
      content: 'Génération de la réponse en cours...',
      ephemeral: true,
    });

    const question = modalSubmit.fields.getTextInputValue('questionInput');

    if (question && question !== '') {
      await modalSubmit.followUp({
        content: question,
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    }
    firstMessage.delete();
  } catch (error) {
    console.error('Erreur dans aiSay:', error);
    await interaction.reply({
      content: "Une erreur s'est produite",
      ephemeral: true,
    });
  }
}

