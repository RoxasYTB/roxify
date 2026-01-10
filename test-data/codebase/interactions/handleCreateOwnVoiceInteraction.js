import { MessageFlags } from 'discord.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };

async function handleCreateOwnVoiceInteraction(interaction) {
  if (!interaction.isChannelSelectMenu()) return;

  const language = interaction.locale || 'fr';

  const selectedChannel = interaction.guild.channels.cache.get(
    interaction.values[0],
  );
  await interaction.deferUpdate();
  if (!selectedChannel) {
    await interaction.followUp({
      content: interactionTexts[language]?.createOwnVoice?.channelMissing,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const webhookName = `CreateOwnVoiceChannelGlados_${language}`;
  const webhooks = await selectedChannel.fetchWebhooks();
  await Promise.all(
    webhooks
      .filter((w) => w.name.includes('CreateOwnVoiceChannelGlados'))
      .map((w) => w.delete('Supprimer le webhook existant')),
  );

  await selectedChannel.createWebhook({
    name: webhookName,
    reason: 'Needed a webhook to handle voice channel creation',
  });

  await interaction.editReply({
    content: interactionTexts[language]?.createOwnVoice?.success.replace(
      '{channel}',
      `${selectedChannel}`,
    ),
    embeds: [],
    components: [],
  });
}

export { handleCreateOwnVoiceInteraction };

