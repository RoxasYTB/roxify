import { updateBlacklist } from '../blacklistManager.js';

export default async function isBlacklistCommand(m) {
  const userIds = m.content
    .slice('.bl? '.length)
    .trim()
    .replace(/[<@>]/g, '')
    .split(' ');
  const blacklist = await updateBlacklist(m.client);

  const blacklistUserIds = userIds.filter((userId) =>
    blacklist.includes(userId),
  );
  const nonBlacklistUserIds = userIds.filter(
    (userId) => !blacklist.includes(userId),
  );

  const embed = {
    title: 'Vérification des utilisateurs blacklistés',
    fields: [
      {
        name: 'Utilisateurs blacklistés',
        value:
          blacklistUserIds.length > 0 ?
            `<@${blacklistUserIds.join('>\n<@')}>`
          : "Aucun utilisateur n'est blacklisté dans la liste que vous m'avez donné.",
        inline: true,
      },
      {
        name: 'Utilisateurs non blacklistés',
        value:
          nonBlacklistUserIds.length > 0 ?
            `<@${nonBlacklistUserIds.join('>\n<@')}>`
          : "Tous les utilisateurs de la liste que vous m'avez donné sont blacklistés.",
        inline: true,
      },
    ],
  };

  return m.reply({
    embeds: [embed],
  });
}

