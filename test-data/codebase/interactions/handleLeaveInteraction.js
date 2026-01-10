import { EmbedBuilder, MessageFlags } from 'discord.js';
import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { encode } from '../utils/3y3.js';

async function handleLeaveInteraction(interaction) {
  if (!interaction.isChannelSelectMenu()) return;
  const language = interaction.customId.split('_')[2] || 'fr';
  const selectedChannel = interaction.guild.channels.cache.get(
    interaction.values[0],
  );
  await interaction.deferUpdate();
  if (!selectedChannel) {
    await interaction.followUp({
      content: interactionTexts[language]?.leave?.notFound,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await selectedChannel.setTopic(encode('leave_' + language));
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(embedColor)
        .setDescription(interactionTexts[language]?.leave?.confirm),
    ],
    components: [],
    flags: MessageFlags.Ephemeral,
  });
}

export { handleLeaveInteraction };

