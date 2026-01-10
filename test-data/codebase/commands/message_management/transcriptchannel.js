import { transcriptChannel } from '../../utils/transcriptChannel.js';

async function transcriptchannel(message, channelName, language = 'fr') {
  const channel = message.channel;
  await message.delete();

  if (!channel.isTextBased?.() && channel.type !== 0) {
    return channel.send(
      language === 'fr' ?
        'Cette commande ne peut être utilisée que dans un salon textuel.'
      : 'This command can only be used in a text channel.',
    );
  }

  const { failed, logMessage } = await transcriptChannel(
    channel,
    message.author,
    language,
  );

  if (failed) return channel.send(logMessage);
  else
    return channel.send(
      language === 'fr' ?
        'Le transcript a été envoyée dans le salon de logs.'
      : 'The transcript has been sent to the logs channel.',
    );
}

export { transcriptchannel };

