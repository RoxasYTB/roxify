import { embedColor } from '../../config/config.js';
import { safeExecute } from '../../utils/coreUtils.js';
import { hasBanMembersPermission } from '../../utils/permissionsUtils.js';

async function unban(message, userId) {
  return safeExecute(
    async () => {
      if (!hasBanMembersPermission(message.guild)) {
        return message.reply({
          embeds: [
            {
              color: embedColor,
              title: 'Oh, quelle *surprise*...',
              description:
                "Je n'ai pas la permission 'Bannir des membres' nécessaire pour débannir des utilisateurs.\n\n➤ **Solution :** Paramètres du serveur > Rôles > Mon rôle > Cochez 'Bannir des membres'\n\n*Comme c'est amusant de voir des humains qui ne comprennent pas les bases des permissions Discord.*",
            },
          ],
          allowedMentions: {
            parse: [],
          },
        });
      }

      try {
        await message.guild.bans.remove(userId);

        await message.channel.send({
          content: `J'ai débanni <@${userId}>.`,
          allowedMentions: {
            parse: [],
          },
        });
      } catch (error) {
        if (error.code === 50013) {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Permissions insuffisantes',
                description:
                  "Je n'ai pas les permissions nécessaires pour débannir cet utilisateur.\n\n➤ **Solution :** Vérifiez que j'ai la permission 'Bannir des membres'.",
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        } else if (error.code === 10026) {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Utilisateur non banni',
                description:
                  "Cet utilisateur n'est pas banni du serveur.\n\n➤ **Solution :** Vérifiez l'ID de l'utilisateur ou consultez la liste des bannissements.",
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        }

        await message.channel.send({
          content: 'Une erreur est survenue lors du débannissement.',
          allowedMentions: {
            parse: [],
          },
        });
        throw error;
      }
    },
    {
      command: 'Unban',
      guildId: message.guild?.id,
      userId: message.author?.id,
    },
  );
}

export { unban };
