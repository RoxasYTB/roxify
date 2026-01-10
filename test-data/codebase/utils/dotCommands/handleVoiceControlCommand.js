import { createCustomVoiceEmbed } from '../createCustomVoiceEmbed.js';
export default function handleVoiceControlCommand(m) {
  return createCustomVoiceEmbed(
    m.channel,
    {
      isPrivate: false,
      limited: false,
      properties: {
        microphone: true,
        video: true,
        soundboards: true,
      },
    },
    'fr',
    m.author.id,
  );
}
