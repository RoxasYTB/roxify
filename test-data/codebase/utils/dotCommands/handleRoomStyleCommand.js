import { convertText } from '../fontConverter.js';
export default async function handleRoomStyleCommand(m) {
  const cat = m.guild.channels.cache
    .filter((c) => c.type == 4)
    .sort((a, b) => b.children.cache.size - a.children.cache.size)
    .first();
  if (!cat)
    return m.reply({
      content: "Ce salon n'est pas dans une catégorie.",
    });
  const [, style] = m.content.split(' ');
  const msg = Array.from(cat.children.cache.values()).reduce(
    (a, c) => a + `    ${convertText(c.name, style)} \n`,
    `Les salons seront renommés comme suit :\n\n\n`,
  );
  m.reply({
    content: '```' + msg + '```',
  });
}

