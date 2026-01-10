import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
export default async function handleSetupTempCloseCommand(m) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket-fr`)
      .setLabel('Fermer le ticket')
      .setStyle(ButtonStyle.Danger),
  );
  await m.channel.send({
    content: 'Cliquez sur le bouton ci-dessous pour fermer le ticket',
    components: [row],
  });
}

