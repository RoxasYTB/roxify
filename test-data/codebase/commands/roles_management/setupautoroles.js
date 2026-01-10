import { encode } from '../../utils/3y3.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function setupautoroles(message, _, roleId) {
  try {
    await message.channel.setTopic(encode(`autorole_${roleId}`));
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { setupautoroles };
