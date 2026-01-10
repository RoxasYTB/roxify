import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { captchaBaseUrl, embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { safeExecute, safeReply } from '../utils/coreUtils.js';

async function handleVerificationInteraction(interaction) {
  return safeExecute(
    async () => {
      if (
        !interaction.isStringSelectMenu() ||
        !interaction.customId.includes('verification_code')
      ) {
        return;
      }

      const language = interaction.customId.split('_')[2] || 'fr';
      const selectedValue = interaction.values[0];
      const valueParts = selectedValue.split('_');
      const roleId = valueParts[valueParts.length - 1];
      const isCorrect = selectedValue.includes('right_code');

      const msg =
        interactionTexts[language]?.verification ||
        interactionTexts.fr.verification;

      await interaction.deferUpdate();

      if (isCorrect) {
        await safeExecute(
          async () => {
            await interaction.member.roles.add(roleId);
            await interaction.followUp({
              content: msg.success,
              flags: MessageFlags.Ephemeral,
            });
          },
          {
            command: 'AddVerificationRole',
            roleId,
            userId: interaction.user.id,
            fallbackError: async () => {
              await interaction.followUp({
                content: msg.roleError,
                flags: MessageFlags.Ephemeral,
              });
            },
          },
        );
      } else {
        await interaction.followUp({
          content: msg.failure,
          flags: MessageFlags.Ephemeral,
        });
      }

      await regenerateCaptcha(interaction, language, roleId, msg);
    },
    {
      command: 'VerificationInteraction',
      customId: interaction?.customId,
      userId: interaction?.user?.id,
    },
  );
}

async function regenerateCaptcha(interaction, language, roleId, msg) {
  return safeExecute(
    async () => {
      const generateNewCaptcha = () => {
        const genCode = () =>
          Array.from(
            {
              length: 7,
            },
            () =>
              'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[
                Math.floor(Math.random() * 36)
              ],
          ).join('');

        const codes = Array.from(
          {
            length: 3,
          },
          genCode,
        );
        const idx = Math.floor(Math.random() * 3);
        const correctCode = codes[idx];

        const opts = codes.map((c, i) => ({
          label: `${msg.codeLabel} ${i + 1}`,
          description: c,
          value:
            i === idx ?
              `right_code${i + 1}_${roleId}`
            : `wrong_code${i + 1}_${roleId}`,
        }));

        return {
          codes,
          idx,
          correctCode,
          opts,
        };
      };

      const { correctCode, opts } = generateNewCaptcha();

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`verification_code_${language}`)
          .setPlaceholder(msg.placeholder)
          .addOptions(opts),
      );
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(msg.title)
        .setDescription(
          msg.description.replace('{serverName}', interaction.guild.name),
        )
        .setImage('attachment://captcha.webp');

      await interaction.message.edit({
        embeds: [embed],
        components: [row],
        files: [
          {
            attachment: `${captchaBaseUrl}/captcha/${correctCode}`,
            name: 'captcha.webp',
          },
        ],
      });
    },
    {
      command: 'RegenerateCaptcha',
      roleId,
      fallbackError: async () => {
        await safeReply(interaction, {
          content:
            msg.error ||
            '<:false:1304519593083011093> Erreur lors de la régénération du captcha.',
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  );
}

export { handleVerificationInteraction };

