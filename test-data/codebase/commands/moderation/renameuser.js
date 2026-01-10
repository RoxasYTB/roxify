import { embedColor } from '../../config/config.js';
import { checkModerationPermissions } from '../../utils/permissionsUtils.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

function isValidSnowflake(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

async function renameuser(message, id, newName) {
  if (!isValidSnowflake(id)) {
    return message.reply({
      embeds: [
        {
          color: embedColor,
          title: 'ID invalide',
          description:
            "L'ID utilisateur fourni n'est pas valide.\n\n➤ **Solution :** Vérifiez que l'ID contient uniquement des chiffres et fait entre 17 et 20 caractères.",
        },
      ],
      allowedMentions: {
        parse: [],
      },
    });
  }

  try {
    const permissionCheck = await checkModerationPermissions(
      message,
      id,
      'nickname',
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
      await targetMember.setNickname(newName);
    } catch (nicknameError) {
      if (nicknameError.code === 50013 || nicknameError.code === 40333) {
        const botMember = message.guild.members.me;
        const isHierarchyIssue =
          targetMember.roles.highest.position >=
          botMember.roles.highest.position;

        if (isHierarchyIssue || nicknameError.code === 40333) {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Hiérarchie des rôles - Bot',
                description: `Je ne peux pas modifier le pseudo de <@${id}> car cette personne possède un rôle plus haut ou égal au mien dans la hiérarchie.\n\n➤ **Solution :** Glissez mon rôle <@&${botMember.roles.highest.id}> AU-DESSUS du rôle <@&${targetMember.roles.highest.id}> dans la liste des rôles du serveur.`,
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
                  "Je n'ai pas les permissions nécessaires pour modifier le pseudo de cet utilisateur.\n\n➤ **Solution :** Vérifiez que j'ai la permission 'Gérer les pseudos' dans les paramètres du serveur.",
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        }
      } else if (nicknameError.code === 50001) {
        return message.reply({
          embeds: [
            {
              color: embedColor,
              title: 'Accès manquant',
              description:
                "Je n'ai pas accès à cet utilisateur.\n\n➤ **Solution :** Vérifiez que l'utilisateur est bien membre du serveur.",
            },
          ],
          allowedMentions: {
            parse: [],
          },
        });
      }
      throw nicknameError;
    }
  } catch (error) {
    triggerErrorEmbed(`Erreur lors du renommage de l'utilisateur`, {
      command: 'RenameUser',
      userId: id,
      newNickname: newName,
      guildId: message.guild?.id,
      error: error,
    });

    await message.channel.send({
      content: 'Une erreur est survenue lors du changement de pseudo.',
      allowedMentions: {
        parse: [],
      },
    });
  }
}

export { renameuser };

