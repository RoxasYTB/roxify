import { PermissionsBitField } from 'discord.js';
import { getClosestChannel } from '../../utils/findClosestMatch.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function managesendroom(message, roomName, unlock) {
  try {
    const c = getClosestChannel(message.guild, roomName);
    if (!c) return;
    const perms = [
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.CreatePrivateThreads,
    ];

    const validPermissions = [];

    if (message.guild.id) {
      validPermissions.push({
        id: message.guild.id,
        deny: unlock ? [] : perms,
        allow:
          unlock ? perms : (
            [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.ReadMessageHistory,
            ]
          ),
      });
    }

    if (message.client.user.id) {
      validPermissions.push({
        id: message.client.user.id,
        allow: [
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.CreatePublicThreads,
          PermissionsBitField.Flags.CreatePrivateThreads,
        ],
      });
    }

    await c.permissionOverwrites.set(validPermissions);
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}
export { managesendroom };

