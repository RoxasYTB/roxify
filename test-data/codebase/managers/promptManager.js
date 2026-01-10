import { encode } from '../utils/3y3.js';
import { detectLanguage } from '../utils/detectLanguage.js';
import WhiteList from '../whitelist.json' with { type: 'json' };

module.exports.FormatEntranceMessage = async (message) => {
  const history = (
    await message.channel.messages.fetch({
      limit: 10,
      before: message.id,
    })
  ).reverse();

  let context = history
    .map(
      (msg) =>
        `(${msg.author.id} ) ${msg.author.username.replace(message.client.user.username, WhiteList.BotName)} : ${msg.content} \n`,
    )
    .join(encode('split'));

  const language = detectLanguage(message.content);

  let trimmedContext = context;

  return {
    formattedMessage: trimmedContext,
    language,
  };
};

