export default async function handleArriverderci(m) {
  const g = m.guild;
  if (!g) return m.reply("Serveur introuvable. Vérifiez l'ID du serveur.");
  await m.reply('Je quitte le serveur, bye bye !');
  setTimeout(() => g.leave(), 1000);
}

