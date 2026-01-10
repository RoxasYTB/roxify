import { embedColor } from '../../config/config.js';
import { fetchGuildWithData, getAllGuilds } from '../guildUtils.js';

const permissionNames = {
  CreateInstantInvite: 'Créer des invitations instantanées',
  KickMembers: 'Expulser des membres',
  BanMembers: 'Bannir des membres',
  Administrator: 'Administrateur',
  ManageChannels: 'Gérer les salons',
  ManageGuild: 'Gérer le serveur',
  AddReactions: 'Ajouter des réactions',
  ViewAuditLog: 'Voir les logs',
  PrioritySpeaker: 'Parler en priorité',
  Stream: "Faire un partage d'écran",
  ViewChannel: 'Voir les salons',
  SendMessages: 'Envoyer des messages',
  SendTTSMessages: 'Envoyer des messages TTS',
  ManageMessages: 'Gérer les messages',
  EmbedLinks: 'Intégrer des liens',
  AttachFiles: 'Joindre des fichiers',
  ReadMessageHistory: "Lire l'historique des messages",
  MentionEveryone: 'Mentionner @everyone et @here',
  UseExternalEmojis: 'Utiliser des émojis externes',
  ViewGuildInsights: 'Voir les statistiques du serveur',
  Connect: 'Se connecter en vocal',
  Speak: 'Parler en vocal',
  MuteMembers: 'Rendre muet des membres',
  DeafenMembers: 'Mettre en sourdine des membres',
  MoveMembers: 'Déplacer des membres en vocal',
  UseVAD: 'Utiliser la détection vocale',
  ChangeNickname: 'Changer son pseudo',
  ManageNicknames: 'Gérer les pseudos',
  ManageRoles: 'Gérer les rôles',
  ManageWebhooks: 'Gérer les webhooks',
  ManageEmojisAndStickers: 'Gérer les émojis et autocollants',
  UseApplicationCommands: "Utiliser les commandes d'application",
  RequestToSpeak: 'Demander la parole',
  ManageEvents: 'Gérer les événements',
  ManageThreads: 'Gérer les fils',
  CreatePublicThreads: 'Créer des fils publics',
  CreatePrivateThreads: 'Créer des fils privés',
  UseExternalStickers: 'Utiliser des autocollants externes',
  SendMessagesInThreads: 'Envoyer des messages dans les fils',
  UseEmbeddedActivities: 'Utiliser les activités intégrées',
  ModerateMembers: 'Modérer les membres (timeout)',
  ViewCreatorMonetizationAnalytics: 'Voir les analyses de monétisation',
  UseSoundboard: 'Utiliser les soundboards',
  UseExternalSounds: 'Utiliser des sons externes',
  SendVoiceMessages: 'Envoyer des messages vocaux',
};

export default async function getPermsCommand(m) {
  try {
    let serverId = m.content.slice('.perms '.length).trim();
    let guild;

    if (!serverId && m.guild) {
      serverId = m.guild.id;
      guild = m.guild;
    } else if (serverId === m.guild?.id) {
      guild = m.guild;
    } else {
      const allGuilds = await getAllGuilds(m.client);
      const guildInfo = allGuilds.find((g) => g.id === serverId);

      if (guildInfo) {
        const guildData = await fetchGuildWithData(m.client, guildInfo.id);
        if (guildData && guildData.botMember) {
          guild = {
            id: guildData.id,
            name: guildData.name,
            members: {
              cache: new Map([
                [
                  m.client.user.id,
                  {
                    permissions: {
                      toArray: () => guildData.botMember.permissions,
                    },
                  },
                ],
              ]),
            },
          };
        }
      }
    }

    if (!guild)
      return m.reply("Serveur introuvable. Vérifiez l'ID du serveur.");

    const botMember = guild.members.cache.get(m.client.user.id);
    if (!botMember) return m.reply('Je ne suis pas membre de ce serveur.');
    const botPermissions = botMember.permissions;

    const permissions = botPermissions
      .toArray()
      .map((perm) => permissionNames[perm] || perm);
    const embed = {
      color: embedColor,
      title: `Permissions sur le serveur ${guild.name} (${serverId})`,
      description:
        botPermissions.has('Administrator') ?
          "J'ai le rôle administrateur, donc je peux tout faire sur ce serveur."
        : 'Je ne suis pas administrateur !!',
      fields: [
        {
          name: 'Permissions',
          value:
            permissions.length > 0 ?
              `- ${permissions.join('\n- ')}`
            : 'Aucune permission accordée.',
        },
      ],
    };

    return m.reply({
      embeds: [embed],
    });
  } catch (error) {
    console.error('Erreur dans la commande perms:', error);
    return m.reply(
      "Une erreur s'est produite lors de la récupération des permissions.",
    );
  }
}

