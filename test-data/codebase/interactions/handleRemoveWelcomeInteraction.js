import { EmbedBuilder, MessageFlags } from 'discord.js';
import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { encode } from '../utils/3y3.js';
import { safeExecute } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handleRemoveWelcomeInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction?.guild?.channels) {
        return triggerErrorEmbed(
          new Error('Interaction, guild ou channels manquant'),
          {
            command: 'RemoveWelcomeInteraction',
            interaction,
          },
        );
      }

      const channels = interaction.guild.channels.cache;
      const idParts = interaction.customId.split('_');
      const language = idParts[2] || 'fr';
      const txt =
        interactionTexts[language]?.removewelcome ||
        interactionTexts.fr.removewelcome;

      if (interaction.customId.startsWith('removewelcome_cancel_')) {
        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setColor(embedColor)
              .setDescription(txt.cancelled),
          ],
          components: [],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId.startsWith('removewelcome_confirm_')) {
        const welcomeChannels = channels.filter(
          (c) =>
            c.type === 0 &&
            c.topic &&
            (c.topic.includes(encode('join_')) ||
              c.topic.includes(encode('leave_'))),
        );

        let removedCount = 0;
        const removedChannels = [];

        for (const channel of welcomeChannels.values()) {
          await safeExecute(
            async () => {
              await channel.setTopic(null);
              removedCount++;
              removedChannels.push(`<#${channel.id}>`);
            },
            {
              command: 'RemoveWelcomeChannelTopic',
              channelId: channel.id,
              silent: true,
            },
          );
        }

        if (removedCount > 0) {
          await interaction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(txt.success_title)
                .setDescription(
                  `${txt.success_description}\n\n` +
                    `${txt.channels_cleared}:\n${removedChannels.join('\n')}`,
                ),
            ],
            components: [],
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(txt.no_channels_found),
            ],
            components: [],
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    },
    {
      command: 'RemoveWelcomeInteraction',
      customId: interaction?.customId,
    },
  );
}

export { handleRemoveWelcomeInteraction };

