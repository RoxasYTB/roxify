export default async function handleUnbanAllCommand(m) {
  const bans = await m.guild.bans.fetch();
  if (!bans.size)
    return m.reply({
      content: "Il n'y a aucun membre banni sur ce serveur.",
    });
  for (const [id] of bans) await m.guild.members.unban(id);
  m.reply({
    content: `Tout les membres ont été débannis.`,
  });
}

