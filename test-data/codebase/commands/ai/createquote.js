async function createquote(interaction, { blacklist }) {
  if (blacklist.includes(interaction.user.id)) {
    return interaction.reply({
      content: "Vous n'êtes pas autorisé à utiliser ce bot.",
      ephemeral: true,
    });
  }

  const msg = interaction.targetMessage;
  const content = msg.content
    .split('\n')[0]
    .replace(/<[^>]+>|:\w+:|#\w+|\b\d+\b/g, '')
    .trim();

  if (!content) {
    return interaction.reply({
      content: 'Pas de texte ici, mon ami',
      ephemeral: true,
    });
  }

  const imageLink = `http://localhost:9872/quote/${encodeURIComponent(content.replace(/%20/g, '%C2%A0'))}/${encodeURIComponent(msg.author.displayName)}/${encodeURIComponent(msg.author.username)}/${msg.author.id}/${encodeURIComponent(msg.author.avatar)}`;

  try {
    const firstMessage = await interaction.reply({
      content: 'Création de la citation en cours...',
      ephemeral: true,
    });

    await interaction.followUp({
      embeds: [{ color: 0xffd700, image: { url: 'attachment://quote.webp' } }],
      files: [{ attachment: imageLink, name: 'quote.webp' }],
    });

    firstMessage.delete();
  } catch (error) {
    console.error('Erreur lors de la création de la citation:', error);
  }
}

export default createquote;

