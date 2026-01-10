import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function createlounge(
  message,
  roomName,
  type,
  parent,
  permissionOverwrites = [],
) {
  try {
    let name =
      type === 0 ? roomName.toLowerCase().replace(/ /g, '-') : roomName;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      name = 'salon-sans-nom';
    }
    name = name.trim().slice(0, 100);

    const category =
      parent && parent !== 'none' && type !== 4 ?
        message.guild.channels.cache.find(
          (c) =>
            c.name?.toLowerCase().includes(parent.toLowerCase()) && c.type == 4,
        )
      : null;
    const createdChannel = await message.guild.channels.create({
      name,
      type,
      parent: category?.id,
      permissionOverwrites,
    });
    return createdChannel;
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
    return null;
  }
}

export { createlounge };

