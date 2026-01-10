import { MessageFlags } from 'discord.js';
import { renameroom } from '../../commands/channel_management/renameroom.js';
import { convertText, fonts } from '../../utils/fontConverter.js';
const changefontserverrooms = async (message, targetfont) => {
  const av = Object.keys(fonts);
  if (!av.includes(targetfont))
    return message.channel.send({
      content: `${message.author}, la police d'écriture \`${targetfont}\` n'est pas disponible. Voici les polices d'écriture disponibles : \`${av.map((f) => convertText(f, f)).join(', ')} \``,
      flags: MessageFlags.Ephemeral,
    });
  for (const c of message.guild.channels.cache.values())
    if (c.name) {
      const n = convertText(c.name, targetfont);
      if (n !== c.name) {
        await renameroom(message, c.name, n);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  message.reply({
    content: `J'ai changé la police d'écriture du serveur en \`${convertText(targetfont, targetfont)}\`.`,
    flags: MessageFlags.Ephemeral,
  });
};
export { changefontserverrooms };

