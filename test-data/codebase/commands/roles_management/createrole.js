import { PermissionsBitField } from 'discord.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function createrole(message, roleName, roleColor, hasAdminPerm) {
  try {
    const perms = hasAdminPerm ? Object.values(PermissionsBitField.Flags) : [];
    const options = {
      name: roleName,
      permissions: perms,
      hoist: true,
    };
    if (roleColor && roleColor !== 'none' && typeof roleColor === 'string') {
      let colorValue = roleColor.startsWith('#') ? roleColor : `#${roleColor}`;
      options.color = parseInt(colorValue.replace('#', ''), 16);
    }
    await message.guild.roles.create(options);
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { createrole };

