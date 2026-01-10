import { purgeroom } from '../channel_management/purgeroom.js';

async function deletemessage(message, userId, numMessagesToDelete) {
  if (!message.channel) {
    return await message.reply({
      content: 'Erreur: impossible de trouver le canal.',
    });
  }

  if (numMessagesToDelete === 'all')
    return await purgeroom(message, message.channel.name);
  let limit = parseInt(numMessagesToDelete) + 1;
  if (isNaN(limit))
    return await message.reply({
      content: 'Le nombre de messages à supprimer doit être un nombre valide.',
    });
  if (limit > 100) limit = 100;
  const msgs = (
    await message.channel.messages.fetch({
      limit,
    })
  ).filter((msg) => userId === 'none' || msg.author.id === userId);
  await message.channel.bulkDelete(msgs, true);
}

export { deletemessage };

