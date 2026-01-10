export default async function handleQuoiFeur(m) {
  const clean = m.content
    .toLowerCase()
    .trim()
    .replace(/[.,/#!?$%^&*;:{}=\-_`~()]/g, '')
    .replaceAll('?', '');
  const words = clean.replaceAll(' ?', '?').split(' '),
    last = words.at(-1),
    before = words.at(-2);
  if (
    (last == 'quoi' ||
      (before == 'quoi' && last == '') ||
      last.includes('quoi')) &&
    m.guild?.id == '690593275177992242'
  )
    await m.reply('Feur.');
}

