import { EmbedBuilder } from 'discord.js';
import { processDiscordVoiceMessage } from '../../audio2text/index.js';

async function transcript(interaction, { blacklist }) {
  if (blacklist.includes(interaction.user.id)) {
    return interaction.reply({
      content: "Vous n'êtes pas autorisé à utiliser ce bot.",
      ephemeral: true,
    });
  }

  try {
    const msg = interaction.targetMessage;

    const attachment = msg.attachments.first();

    if (!attachment || !attachment.url) {
      return interaction.reply({
        content: "Aucun message audio n'a été détecté dans ce message.",
        ephemeral: true,
      });
    }

    try {
      await interaction.reply({
        content: 'Transcription audio détectée. Traitement en cours...',
      });

      const transcriptionResult = await processDiscordVoiceMessage(
        attachment.url,
      );

      const transcriptionEmbed = new EmbedBuilder()
        .setColor('#FFDD00')
        .setDescription(
          transcriptionResult?.transcription ||
            "Aucun texte détecté dans l'audio.",
        );

      if (msg.author) {
        transcriptionEmbed.setAuthor({
          name: `Transcription du vocal de ${msg.author.tag}`,
          iconURL: msg.author.displayAvatarURL({ dynamic: true }),
        });
      }

      try {
        await interaction.deleteReply();
      } catch (err) {
        console.error('Could not delete reply:', err);
      }

      await interaction.followUp({
        embeds: [transcriptionEmbed],
      });
    } catch (audioError) {
      console.error('Erreur lors de la transcription audio:', audioError);
      if (interaction.replied) {
        await interaction.followUp({
          content:
            "Une erreur s'est produite lors de la transcription audio: " +
            audioError.message,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content:
            "Une erreur s'est produite lors de la transcription audio: " +
            audioError.message,
          ephemeral: true,
        });
      }
    }
  } catch (error) {
    console.error('Erreur dans transcript:', error);

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Une erreur s'est produite lors de la transcription.",
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: "Une erreur s'est produite lors de la transcription.",
          ephemeral: true,
        });
      }
    } catch (replyError) {
      console.error("Impossible d'envoyer un message d'erreur:", replyError);
    }
  }
}

export default transcript;

