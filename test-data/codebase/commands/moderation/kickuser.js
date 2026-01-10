import { embedColor } from '../../config/config.js';
import { checkModerationPermissions } from '../../utils/permissionsUtils.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function kickuser(message, userId, reason) {
  try {
    const permissionCheck = await checkModerationPermissions(
      message,
      userId,
      'kick',
    );

    if (permissionCheck.error) {
      const detailedMessage =
        permissionCheck.message || 'Erreur de permissions détectée.';
      const solution = permissionCheck.solution || '';

      if (permissionCheck.error === 'user_role_hierarchy') {
        return message.reply({
          embeds: [
            {
              color: embedColor,
              title: 'Hiérarchie des rôles',
              description: `${detailedMessage} \n\n${solution}`,
            },
          ],
          allowedMentions: {
            parse: [],
          },
        });
      } else {
        return message.reply({
          embeds: [
            {
              color: embedColor,
              title: 'Oh, quelle *surprise*...',
              description: `${detailedMessage} \n\n${solution} \n\n*Comme c'est amusant de voir des humains qui ne comprennent pas les bases des permissions Discord.*`,
            },
          ],
          allowedMentions: {
            parse: [],
          },
        });
      }
    }

    const { targetMember } = permissionCheck;

    try {
      await targetMember.kick(reason);
    } catch (kickError) {
      if (kickError.code === 50013) {
        const botMember = message.guild.members.me;
        const isHierarchyIssue =
          targetMember.roles.highest.position >=
          botMember.roles.highest.position;

        if (isHierarchyIssue) {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Hiérarchie des rôles - Bot',
                description: `Je ne peux pas expulser <@${userId}> car cette personne possède un rôle plus haut ou égal au mien dans la hiérarchie.\n\n➤ **Solution :** Glissez mon rôle <@&${botMember.roles.highest.id}> AU-DESSUS du rôle <@&${targetMember.roles.highest.id}> dans la liste des rôles du serveur.`,
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        } else {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Permissions insuffisantes',
                description:
                  "Je n'ai pas les permissions nécessaires pour expulser cet utilisateur.\n\n➤ **Solution :** Vérifiez que j'ai la permission 'Expulser des membres' dans les paramètres du serveur.",
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        }
      }
      throw kickError;
    }

    const confirmationMessage = `J'ai expulsé <@${userId}> pour : "${reason} ".￶`;
    await message.channel.send({
      content: confirmationMessage,
      allowedMentions: {
        parse: [],
      },
    });
  } catch (err) {
    triggerErrorEmbed(`Erreur lors du kick de l'utilisateur ${userId}`, {
      command: 'KickUser',
      userId: userId,
      guildId: message.guild?.id,
      error: err,
    });

    await message.channel.send({
      content:
        "Une erreur est survenue lors de l'expulsion de cet utilisateur.",
      allowedMentions: {
        parse: [],
      },
    });
  }
}
export { kickuser };

