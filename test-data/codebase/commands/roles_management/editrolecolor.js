import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function editrolecolor(message, roleId, newRoleColor) {
  try {
    const r = message.guild.roles.cache.get(roleId);
    if (r)
      await r.edit({
        color: newRoleColor.replace('#', ''),
      });
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { editrolecolor };

