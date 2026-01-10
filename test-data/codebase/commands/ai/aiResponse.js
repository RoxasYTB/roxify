import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export default async function aiResponse(interaction, { blacklist }) {
  if (blacklist.includes(interaction.user.id)) {
    return interaction.reply({
      content: "Vous n'êtes pas autorisé à utiliser ce bot.",
      ephemeral: true,
    });
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
            .setPlaceholder(
              '[FACULTATIF] Ajoute ici une question ou un contexte supplémentaire pour la réponse du bot.',
            ),
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
    const msg = interaction.targetMessage;

    const response = await fetch('http://localhost:6259/glados-min', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: `${interaction.user.username} : ${question}\nTu réponds à ${msg.author.username}\n${msg.author.username} : ${msg.content}`,
      }),
    }).then((r) => r.json());

    if (question && question !== '') {
      await modalSubmit.followUp({
        content: response.response,
        ephemeral: false,
      });
    }

    firstMessage.delete();
  } catch (error) {
    console.error('Erreur dans aiResponse:', error);

    await interaction.reply({
      content: 'Une erreur est survenue lors de la génération de la réponse.',
      ephemeral: true,
    });
  }
}

