async function fetchAllMessages(channel) {
  if (!channel) {
    throw new Error('Canal non fourni');
  }

  try {
    await channel.fetch();
  } catch (error) {
    if (error.code === 10003) {
      throw new Error('Canal inexistant ou inaccessible');
    }
    throw error;
  }

  let messages = [];
  let lastMessageId = null;

  while (true) {
    try {
      const fetchedMessages = await channel.messages.fetch({
        limit: 100,
        before: lastMessageId,
      });
      if (fetchedMessages.size === 0) break;
      messages = [...fetchedMessages.values(), ...messages];
      lastMessageId = fetchedMessages.last().id;
    } catch (error) {
      if ([10003, 50001, 50013].includes(error.code)) {
        break;
      }
      throw error;
    }
  }

  return messages;
}
export { fetchAllMessages };

