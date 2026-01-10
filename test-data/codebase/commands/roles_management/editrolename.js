import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function editrolename(message, roleId, newRoleName) {
  try {
    const r = message.guild.roles.cache.get(roleId);
    if (r)
      await r.edit({
        name: newRoleName,
      });
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { editrolename };

