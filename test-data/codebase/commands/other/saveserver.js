import { saveGuild } from '../../utils/saveGuild.js';

async function saveserver(message) {
  await saveGuild(message.guild);
}

export { saveserver };
