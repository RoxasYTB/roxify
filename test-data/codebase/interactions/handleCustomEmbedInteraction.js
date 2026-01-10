import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { safeExecute, safeReply } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleCustomEmbedInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction) {
        return triggerErrorEmbed(new Error('Interaction manquante'), {
          command: 'CustomEmbedInteraction',
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith('create_custom_embed_')
      ) {
        return await handleCustomEmbedButton(interaction);
      } else if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith('custom_embed_modal_')
      ) {
        return await handleCustomEmbedModal(interaction);
      }
    },
    {
      command: 'CustomEmbedInteraction',
      customId: interaction?.customId,
    },
  );
}

async function handleCustomEmbedButton(interaction) {
  return safeExecute(
    async () => {
      const language = interaction.customId.split('_').pop() || 'fr';

      const modal = new ModalBuilder()
        .setCustomId(`custom_embed_modal_${language}`)
        .setTitle(interactionTexts[language]?.customEmbed?.modalTitle);

      const titleInput = new TextInputBuilder()
        .setCustomId('embed_title')
        .setLabel(interactionTexts[language]?.customEmbed?.titleLabel)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(
          interactionTexts[language]?.customEmbed?.titlePlaceholder,
        )
        .setRequired(false)
        .setMaxLength(256);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('embed_description')
        .setLabel(interactionTexts[language]?.customEmbed?.descLabel)
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(
          interactionTexts[language]?.customEmbed?.descPlaceholder,
        )
        .setRequired(false)
        .setMaxLength(4000);

      const imageInput = new TextInputBuilder()
        .setCustomId('embed_image')
        .setLabel(interactionTexts[language]?.customEmbed?.imageLabel)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(
          interactionTexts[language]?.customEmbed?.imagePlaceholder,
        )
        .setRequired(false);

      const thumbnailInput = new TextInputBuilder()
        .setCustomId('embed_thumbnail')
        .setLabel(interactionTexts[language]?.customEmbed?.thumbnailLabel)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(
          interactionTexts[language]?.customEmbed?.thumbnailPlaceholder,
        )
        .setRequired(false);

      const colorInput = new TextInputBuilder()
        .setCustomId('embed_color')
        .setLabel(interactionTexts[language]?.customEmbed?.colorLabel)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('#FFD700')
        .setRequired(false)
        .setMaxLength(7);

      const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
      const secondActionRow = new ActionRowBuilder().addComponents(
        descriptionInput,
      );
      const thirdActionRow = new ActionRowBuilder().addComponents(imageInput);
      const fourthActionRow = new ActionRowBuilder().addComponents(
        thumbnailInput,
      );
      const fifthActionRow = new ActionRowBuilder().addComponents(colorInput);

      modal.addComponents(
        firstActionRow,
        secondActionRow,
        thirdActionRow,
        fourthActionRow,
        fifthActionRow,
      );

      await interaction.showModal(modal);
    },
    {
      command: 'CustomEmbedButton',
      customId: interaction?.customId,
    },
  );
}

async function handleCustomEmbedModal(interaction) {
  return safeExecute(
    async () => {
      const language = interaction.customId.split('_').pop() || 'fr';

      const title = interaction.fields.getTextInputValue('embed_title') || null;
      const description =
        interaction.fields.getTextInputValue('embed_description') || null;
      const imageUrl =
        interaction.fields.getTextInputValue('embed_image') || null;
      const thumbnailUrl =
        interaction.fields.getTextInputValue('embed_thumbnail') || null;
      const colorInput =
        interaction.fields.getTextInputValue('embed_color') || embedColor;

      let color = embedColor;
      if (colorInput) {
        const hexMatch = colorInput.match(/^#?([0-9A-Fa-f]{6})$/);
        if (hexMatch) {
          color = parseInt(hexMatch[1], 16);
        }
      }

      const isValidUrl = (string) => {
        try {
          new URL(string);
          return true;
        } catch {
          return false;
        }
      };

      const customEmbed = new EmbedBuilder().setColor(color);

      if (title) customEmbed.setTitle(title);
      if (description) customEmbed.setDescription(description);

      if (imageUrl && isValidUrl(imageUrl)) {
        customEmbed.setImage(imageUrl);
      } else if (imageUrl) {
        return safeReply(interaction, {
          content: interactionTexts[language]?.customEmbed?.invalidImageUrl,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (thumbnailUrl && isValidUrl(thumbnailUrl)) {
        customEmbed.setThumbnail(thumbnailUrl);
      } else if (thumbnailUrl) {
        return safeReply(interaction, {
          content: interactionTexts[language]?.customEmbed?.invalidThumbnailUrl,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!title && !description && !imageUrl && !thumbnailUrl) {
        return safeReply(interaction, {
          content: interactionTexts[language]?.customEmbed?.emptyFields,
          flags: MessageFlags.Ephemeral,
        });
      }

      await safeReply(interaction, {
        content:
          language === 'fr' ?
            '<:true:1304519561814741063> Votre embed personnalisé a été créé avec succès !'
          : '<:true:1304519561814741063> Your custom embed has been created successfully!',
        embeds: [customEmbed],
      });
    },
    {
      command: 'CustomEmbedModal',
      customId: interaction?.customId,
      fallbackError: async () => {
        const language = interaction?.customId?.split('_')?.pop() || 'fr';
        const errorMessage =
          language === 'fr' ?
            "<:false:1304519593083011093> Une erreur est survenue lors de la création de l'embed."
          : '<:false:1304519593083011093> An error occurred while creating the embed.';

        await safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  );
}

export { handleCustomEmbedInteraction };

