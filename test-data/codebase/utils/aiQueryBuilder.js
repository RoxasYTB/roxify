function buildAIQueryContext({
  question,
  contextMessages = [],
  channelInfo,
  channelStyleInfo,
  refContext,
  isRefUsableForCommand,
  serverInfo,
  roleInfo,
  translationLanguage,
  imageContent,
  isDirectMessage,
  authorUsername,
  roxasRef,
  lastMessage,
  guildId,
}) {
  let finalQuestion = question;
  if (roxasRef && lastMessage)
    finalQuestion =
      lastMessage +
      `(Attention, je ne suis pas Roxas. Je suis ${authorUsername}, tiens-en compte. Néanmoins, réponds cependant à ma requête/question. Ne fais pas référence à cette remarque dans ta réponse.)\n`;

  const validLastMessage =
    lastMessage && lastMessage.trim() ? lastMessage.trim()
    : question && question.trim() ? question.trim()
    : 'Hello';

  return {
    question: finalQuestion || validLastMessage,
    contextMessages,
    hasPerms: true,
    amIAdmin: true,
    info: '',
    lastMessage: validLastMessage,
    authorUsername: authorUsername,
    channelInfo,
    channelStyleInfo,
    refContext,
    isRefUsableForCommand,
    serverInfo,
    salonInfo: '',
    roleInfo,
    serverCount: '',
    verifPrompt: '',
    translateInto: translationLanguage,
    imageContent,
    isDmChannel: isDirectMessage,
    guildId: guildId,
  };
}

export { buildAIQueryContext };

