import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { embedColor } from '../../config/config.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';
import whitelist from '../../whitelist.json' with { type: 'json' };

async function createcustomembed(message) {
  const isOwnerBypass = whitelist.OwnerByPass.includes(message.author.id);

  if (!message.member?.permissions.has('ManageMessages') && !isOwnerBypass) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setDescription(
        "<:false:1304519593083011093> Vous n'avez pas la permission d'utiliser cette commande. Permission requise : **Gérer les messages**.",
      );
    await message.channel.send({ embeds: [errorEmbed] });
    return;
  }

  try {
    const embedButton = new ButtonBuilder()
      .setCustomId('create_embed_modal')
      .setLabel('📝 Créer un embed')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(embedButton);

    message.delete().catch(() => {});

    const embedMessage = {
      title: "🛠️ Créateur d'embed personnalisé",
      description:
        'Cliquez sur le bouton ci-dessous pour créer votre embed personnalisé.',
      color: embedColor,
    };

    const sentMessage = await message.channel.send({
      embeds: [embedMessage],
      components: [row],
    });

    const filter = (interaction) =>
      interaction.customId == 'create_embed_modal' &&
      interaction.user.id == message.author.id;

    const collector = sentMessage.createMessageComponentCollector({
      filter,
      time: 300000,
    });
    let lastInteractionId = undefined;

    collector.on('collect', async (interaction) => {
      try {
        lastInteractionId = interaction.id;
        const modal = new ModalBuilder()
          .setCustomId('embed_creation_modal')
          .setTitle('Créer un embed');

        const titleInput = new TextInputBuilder()
          .setCustomId('embed_title')
          .setLabel('Titre')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(256)
          .setPlaceholder('Titre de votre embed...');

        const descriptionInput = new TextInputBuilder()
          .setCustomId('embed_description')
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setPlaceholder('Description de votre embed...');

        const imageInput = new TextInputBuilder()
          .setCustomId('embed_image')
          .setLabel("URL de l'image")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('https://...');

        const footerInput = new TextInputBuilder()
          .setCustomId('embed_footer')
          .setLabel('Pied de page')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(2048)
          .setPlaceholder('Texte du pied de page...');

        const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
        const secondActionRow = new ActionRowBuilder().addComponents(
          descriptionInput,
        );
        const thirdActionRow = new ActionRowBuilder().addComponents(imageInput);
        const fourthActionRow = new ActionRowBuilder().addComponents(
          footerInput,
        );

        modal.addComponents(
          firstActionRow,
          secondActionRow,
          thirdActionRow,
          fourthActionRow,
        );

        await interaction.showModal(modal);

        try {
          const modalSubmission = await interaction.awaitModalSubmit({
            time: 300000,
          });
          if (interaction.id === lastInteractionId) {
            const title =
              modalSubmission.fields.getTextInputValue('embed_title') || null;
            const description =
              modalSubmission.fields.getTextInputValue('embed_description') ||
              null;
            const imageUrl =
              modalSubmission.fields.getTextInputValue('embed_image') || null;
            const footerText =
              modalSubmission.fields.getTextInputValue('embed_footer') || null;

            const embed = new EmbedBuilder().setColor(embedColor);

            if (title) embed.setTitle(title);
            if (description) embed.setDescription(description);
            if (imageUrl && imageUrl.startsWith('http'))
              embed.setImage(imageUrl);
            if (footerText)
              embed.setFooter({
                text: footerText,
              });

            await message.channel.send({
              embeds: [embed],
            });

            await modalSubmission.deferUpdate();

            await sentMessage.delete();
          }
        } catch (modalError) {
          if (
            modalError.code === 'InteractionCollectorError' ||
            modalError.message?.includes(
              'Collector received no interactions',
            ) ||
            modalError.message?.includes('time')
          ) {
            return;
          }

          triggerErrorEmbed(
            modalError,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
      } catch (collectError) {
        triggerErrorEmbed(
          collectError,
          message.client?.user?.username,
          message.client?.user?.displayAvatarURL(),
        );
      }
    });
  } catch (error) {
    if (
      error.code === 'InteractionCollectorError' ||
      error.message?.includes('Collector received no interactions')
    ) {
      return;
    }

    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { createcustomembed };

