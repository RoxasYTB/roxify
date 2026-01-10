import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import {
  candidatureQuestionGroups,
  candidatureTexts,
  embedColor,
} from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { safeExecute, safeReply } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleCandidatureInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction.isButton()) return;

      const language = interaction.customId.split('_').pop() || 'fr';
      const supportedLanguages = Object.keys(candidatureTexts || {});
      const validLanguage =
        supportedLanguages.includes(language) ? language : 'fr';

      if (!candidatureTexts?.[validLanguage]) {
        await triggerErrorEmbed(
          new Error(`Configuration manquante pour la langue: ${validLanguage}`),
          {
            interaction,
            command: 'CandidatureInteraction',
          },
        );
        return await safeReply(interaction, {
          content:
            interactionTexts[validLanguage]?.candidature?.missingConfig ||
            '<:false:1304519593083011093> Configuration manquante.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const msg = candidatureTexts[validLanguage];
      const lbl = candidatureTexts[validLanguage];
      const qGroups = candidatureQuestionGroups;

      if (!lbl.questions || !qGroups || !Array.isArray(qGroups)) {
        await triggerErrorEmbed(
          new Error('Configuration des questions manquante ou invalide'),
          {
            interaction,
            command: 'CandidatureInteraction',
          },
        );
        return await safeReply(interaction, {
          content:
            interactionTexts[validLanguage]?.candidature?.missingQuestions ||
            '<:false:1304519593083011093> Questions configuration missing.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const allQ = Object.keys(lbl.questions);

      try {
        if (
          interaction.customId !== `candidature_${validLanguage}` &&
          interaction.customId !== `create_candidature_${validLanguage}`
        ) {
          return;
        }

        const channelName = `candidature-${interaction.user.username}`;
        if (
          interaction.guild.channels.cache.find((c) => c.name === channelName)
        ) {
          return interaction.reply({
            content:
              interactionTexts[validLanguage]?.candidature?.alreadySubmitted ||
              'Already submitted.',
            flags: MessageFlags.Ephemeral,
          });
        }

        global.candidatureResponses = global.candidatureResponses || new Map();

        const userResponses = global.candidatureResponses.get(
          interaction.user.id,
        ) || {
          currentStep: 0,
        };
        const step = userResponses.currentStep;
        if (step >= qGroups.length) {
          triggerErrorEmbed(
            new Error(
              `Étape invalide: ${step}, maximum: ${qGroups.length - 1}`,
            ),
            {
              command: 'handleCandidatureInteraction-invalidStep',
              userId: interaction.user.id,
              step,
              maxStep: qGroups.length - 1,
            },
          );
          try {
            await interaction.reply({
              content:
                interactionTexts[validLanguage]?.candidature?.invalidStep,
              flags: MessageFlags.Ephemeral,
            });
          } catch (error) {
            triggerErrorEmbed(error, {
              command: 'handleCandidatureInteraction-replyError',
              userId: interaction.user.id,
            });
          }
          return;
        }

        const group = qGroups[step];

        if (!group || !Array.isArray(group) || group.length === 0) {
          await triggerErrorEmbed(
            new Error(`Groupe de questions invalide à l'étape ${step}`),
            {
              interaction,
              command: 'CandidatureInteraction',
            },
          );
          return await safeReply(interaction, {
            content:
              interactionTexts[validLanguage]?.candidature?.invalidQuestions,
            flags: MessageFlags.Ephemeral,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`candidature_${validLanguage}`)
          .setTitle(lbl.modalTitle || 'Formulaire de Candidature')
          .addComponents(
            ...group.map((q) =>
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId(q)
                  .setLabel(lbl.questions[q] || q)
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true),
              ),
            ),
          );

        await interaction.showModal(modal);

        const submitted = await interaction
          .awaitModalSubmit({
            filter: (i) =>
              i.customId === `candidature_${validLanguage}` &&
              i.user.id === interaction.user.id,
            time: 300000,
          })
          .catch(() => null);

        if (!submitted || submitted.replied || submitted.deferred) return;

        group.forEach((q) => {
          userResponses[q] =
            submitted.fields.getTextInputValue(q) || 'Aucune réponse fournie';
        });

        userResponses.currentStep = step + 1;
        global.candidatureResponses.set(interaction.user.id, userResponses);

        if (step < qGroups.length - 1) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`candidature_${validLanguage}`)
              .setLabel(lbl.continueButton || 'Continuer')
              .setStyle(ButtonStyle.Primary),
          );

          const message =
            validLanguage === 'fr' ?
              `🧪 Continuez l'évaluation, ${interaction.user.username} . Phase ${step + 2}/3 en cours.`
            : `🧪 Continue the evaluation, ${interaction.user.username} . Phase ${step + 2}/3 in progress.`;

          try {
            if (step + 2 == 2)
              await submitted.reply({
                content: message,
                components: [row],
                flags: MessageFlags.Ephemeral,
              });
            else
              await submitted.update({
                content: message,
                components: [row],
              });
          } catch (updateError) {
            if (updateError.code === 10062) {
              return;
            }
            throw updateError;
          }
        } else {
          const embeds = [],
            fields = allQ.map((q) => ({
              name: lbl.questions[q] || q,
              value:
                '```reponse\n' +
                (userResponses[q] || 'Aucune').replace(/`/g, '\\`') +
                '\n```',
              inline: false,
            }));

          while (fields.length)
            embeds.push(
              new EmbedBuilder()
                .setColor(embedColor)
                .addFields(fields.splice(0, 5)),
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(
                `submit_application_${validLanguage}_${interaction.user.id}`,
              )
              .setLabel(lbl.submitButton || 'Soumettre')
              .setStyle(ButtonStyle.Success),
          );

          try {
            await submitted.update({
              content: msg.summary || 'Récapitulatif de votre candidature',
              embeds,
              components: [row],
            });
          } catch (updateError) {
            if (updateError.code === 10062) {
              return;
            }
            throw updateError;
          }
          global.candidatureResponses.delete(interaction.user.id);
        }
      } catch (e) {
        if (
          e.code === 'InteractionCollectorError' ||
          e.message?.includes('Collector received no interactions') ||
          e.message?.includes('time')
        ) {
          return;
        }

        if (e.code === 10062) {
          return;
        }

        await triggerErrorEmbed(e, {
          interaction,
          command: 'CandidatureEvaluation',
        });
        return await safeReply(interaction, {
          content: interactionTexts[validLanguage]?.candidature?.evalError,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
    {
      interaction,
      command: 'CandidatureInteraction',
    },
  );
}

export { handleCandidatureInteraction };

