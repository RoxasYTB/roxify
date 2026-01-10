import fs from 'fs';

function formatNumber(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default async function aiMessage(interaction, { client: _client }) {
  try {
    
    await interaction.deferReply({ ephemeral: true });

    const response = await fetch('http://localhost:6259/glados-min', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: `${interaction.targetMessage.author.username} : ${interaction.targetMessage.content}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Erreur de la requête IA : ${response.statusText}`);
    }

    const data = await response.json();

    await interaction.editReply({
      content: 'Message envoyé.',
      ephemeral: true,
    });
    interaction.deleteReply().catch(console.error);

    if (interaction.targetMessage.content.toLowerCase() === 'glados') {
      interaction.followUp({
        content: 'Oui ? que puis-je faire pour vous ?',
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    } else if (
      interaction.targetMessage.content.toLowerCase().includes('comb') &&
      interaction.targetMessage.content.toLowerCase().includes('serv')
    ) {
      const clusterStatsPath =
        '/home/ysannier/Glados-Disc/clusters/cluster-0.json';
      let statsMessage = 'Impossible de récupérer les statistiques.';
      try {
        const statsRaw = fs.readFileSync(clusterStatsPath, 'utf8');
        const stats = JSON.parse(statsRaw);
        statsMessage = `Je suis actuellement sur ${formatNumber(stats.totalServeurs)} serveurs et utilisée par ${formatNumber(stats.totalMembers)} utilisateurs.`;
      } catch (err) {
        console.error('Erreur lors de la lecture des stats cluster:', err);
      }
      interaction.followUp({
        content: statsMessage,
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.followUp({
        content: data.response
          .replaceAll('roxasytb_', 'Roxas')
          .replaceAll('Roxasytb_', 'Roxas'),
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    console.error('Erreur dans aiMessage:', error);
    await interaction.editReply({
      content: "Une erreur s'est produite",
      ephemeral: true,
    });
  }
}


