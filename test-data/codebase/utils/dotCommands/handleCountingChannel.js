import { convertText } from '../fontConverter.js';
export default async function handleCountingChannel(m) {
  const name = convertText(m.channel.name, 'normal').toLowerCase();
  if (!['count', 'compt'].some((w) => name.includes(w))) return;
  if (m.content.includes('\n') || !/^[\d\s]+$/.test(m.content))
    return m.delete();
  const n = parseInt(m.content.replaceAll(' ', ''));
  const last = (
    await m.channel.messages.fetch({
      limit: 10,
    })
  )
    .filter((x) => x.id !== m.id)
    .first();
  const prev = last ? parseInt(last.content.replaceAll(' ', '')) : null;
  if (
    (!last && n !== 1) ||
    (prev !== null && (isNaN(prev) ? n !== 1 : n !== prev + 1)) ||
    (last && last.author.id == m.author.id)
  )
    await m.delete();
}

