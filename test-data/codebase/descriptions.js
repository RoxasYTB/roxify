import { getGuildMembers } from './utils/getGuildMembers.js';

const units = [
  {
    value: 604800000,
    singular: 'semaine',
    plural: 'semaines',
  },
  {
    value: 86400000,
    singular: 'jour',
    plural: 'jours',
  },
  {
    value: 3600000,
    singular: 'heure',
    plural: 'heures',
  },
  {
    value: 60000,
    singular: 'minute',
    plural: 'minutes',
  },
  {
    value: 1000,
    singular: 'seconde',
    plural: 'secondes',
  },
  {
    value: 1,
    singular: 'milliseconde',
    plural: 'millisecondes',
  },
];

function formatDuration(duration) {
  for (const { value, singular, plural } of units) {
    if (duration >= value) {
      const count = Math.floor(duration / value);
      return `${count} ${count === 1 ? singular : plural} `;
    }
  }
  return `${duration} millisecondes`;
}

function isNumericString(str) {
  return /^\d+$/.test(str);
}

const translations = {
  fr: {
    prefix: {
      past: "J'ai ",
      present: 'Je dois ',
    },
    descriptions: {
      renameuser: (past, userId, newName) =>
        `${past ? 'renommé' : 'renommer'} <@${userId}> en "${newName}"${past ? '.' : ' ?'} `,
      resetusername: (past, userId) =>
        `${past ? 'réinitialisé' : 'réinitialiser'} le pseudo de <@${userId}> ${past ? '.' : ' ?'} `,
      createroom: (past, roomName, parent) =>
        `${past ? 'créé' : 'créer'} un salon textuel "${roomName.toLowerCase().replaceAll(' ', '-')}" ${parent !== 'none' ? `dans "${parent}"` : ''}${past ? '.' : ' ?'} `,
      createvocal: (past, roomName, parent) =>
        `${past ? 'créé' : 'créer'} un salon vocal "${roomName}" ${parent !== 'none' ? `dans "${parent}"` : ''}${past ? '.' : ' ?'} `,
      createcategory: (past, roomName) =>
        `${past ? 'créé' : 'créer'} une catégorie "${roomName}"${past ? '.' : ' ?'} `,
      deleteroom: (past, roomName) =>
        `${past ? 'supprimé' : 'supprimer'} le salon "${roomName}"${past ? '.' : ' ?'} `,
      deletevocal: (past, roomName) =>
        `${past ? 'supprimé' : 'supprimer'} le salon vocal "${roomName}"${past ? '.' : ' ?'} `,
      delallroomswiththisname: (past, roomName) =>
        `${past ? 'supprimé' : 'supprimer'} tous les salons contenant "${roomName}" dans le nom${past ? '.' : ' ?'} `,
      renameroom: (past, oldroomName, newroomName) =>
        `${past ? 'renommé' : 'renommer'} "${oldroomName}" en "${newroomName}"${past ? '.' : ' ?'} `,
      renameserver: (past, newroomName) =>
        `${past ? 'renommé' : 'renommer'} le serveur en "${newroomName}"${past ? '.' : ' ?'} `,
      syncpermissionswithcategory: (past, categoryName) =>
        `${past ? 'synchronisé' : 'synchroniser'} les permissions de tous les salons de la catégorie "${categoryName}"${past ? '.' : ' ?'} `,
      createlogsystem: (past) =>
        `${past ? 'créé' : 'créer'} le système de logs${past ? '.' : ' ?'} `,
      copyemojifromserver: (past, serverId) =>
        `${past ? 'copié' : 'copier'} les emojis et les stickers du serveur ${serverId}${past ? '.' : ' ?'} `,
      deletecategory: (past, roomName) =>
        `${past ? 'supprimé' : 'supprimer'} la catégorie "${roomName}"${past ? '.' : ' ?'} `,
      renamecategory: (past, oldroomName, newroomName) =>
        `${past ? 'renommé' : 'renommer'} la catégorie "${oldroomName}" en "${newroomName}"${past ? '.' : ' ?'} `,
      moveroom: (past, roomName, categoryName) =>
        `${past ? 'déplacé' : 'déplacer'} "${roomName}" dans "${categoryName}"${past ? '.' : ' ?'} `,
      banuser: (past, userId, reason) =>
        `${past ? 'banni' : 'bannir'} <@${userId}> pour : "${reason}"${past ? '.' : ' ?'} `,
      kickuser: (past, userId, reason) =>
        `${past ? 'expulsé' : 'expulser'} <@${userId}> pour : "${reason}"${past ? '.' : ' ?'} `,
      unban: (past, userId) =>
        `${past ? 'débanni' : 'débannir'} <@${userId}> ${past ? '.' : ' ?'} `,
      deletemessage: (past, userId, howMany) =>
        `${past ? 'supprimé' : 'supprimer'} "${howMany}" messages${userId === 'none' ? '' : ` de <@${userId}>`} (sans compter celui-ci)${past ? '.' : ' ?'} `,
      muteuser: (past, userId, reason, duration) =>
        `${past ? 'muté' : 'muter'} <@${userId}> pour : "${reason}" pendant ${formatDuration(duration)}${past ? '.' : ' ?'} `,
      unmute: (past, userId) =>
        `${past ? 'démuté' : 'démuter'} <@${userId}> ${past ? '.' : ' ?'} `,
      createrole: (past, roleName, roleColor, _hasAdminPerm) =>
        `${past ? 'créé' : 'créer'} un rôle "${roleName}" (#${typeof roleColor === 'string' ? roleColor.replace('#', '') : roleColor}) `,
      deleterole: (past, roleId, message) => {
        const roleName =
          message.guild.roles.cache.get(roleId)?.name || 'inconnu';
        return `${past ? 'supprimé' : 'supprimer'} le rôle "${roleName}"${past ? '.' : ' ?'} `;
      },
      delallroleswiththisname: (past, roleName) =>
        `${past ? 'supprimé' : 'supprimer'} tous les rôles contenant "${roleName}" dans le nom${past ? '.' : ' ?'} `,
      changefontserverrooms: (past, targetfont) =>
        `${past ? 'modifié' : 'modifier'} la police d'écriture de tous les salons du serveur en ${targetfont}${past ? '.' : ' ? '}`,
      editrolename: (past, roleId, newRoleName) =>
        `${past ? 'renommé' : 'renommer'} le rôle <@&${roleId}> en "${newRoleName}"${past ? '.' : ' ?'}`,
      editrolecolor: (past, roleId, newRoleColorHex) =>
        `${past ? 'recolorié' : 'recolorier'} le rôle <@&${roleId}> en "#${typeof newRoleColorHex === 'string' ? newRoleColorHex.replace('#', '') : newRoleColorHex}"${past ? '.' : ' ?'}`,
      addroletouser: (past, userId, roleId) =>
        `${past ? 'donné' : 'donner'} le rôle <@&${roleId}> à <@${userId}>${past ? '.' : ' ?'}`,
      removerolefromuser: (past, userId, roleId) =>
        `${past ? 'retiré' : 'retirer'} le rôle <@&${roleId}> de <@${userId}>${past ? '.' : ' ?'}`,
      lockyesroom: (past, roomName) =>
        `${past ? 'verrouillé' : 'verrouiller'} le salon "${roomName}"${past ? '.' : ' ?'}`,
      locknoroom: (past, roomName) =>
        `${past ? 'déverrouillé' : 'déverrouiller'} le salon "${roomName}"${past ? '.' : ' ?'}`,
      setroomduration: (past, roomName, duration) =>
        `${past ? 'modifié' : 'modifier'} le cooldown pour le salon "${roomName}" à ${formatDuration(duration)}${past ? '.' : ' ?'}`,
      createticketsystem: (past) =>
        `${past ? 'créé' : 'créer'} un système de ticket dans ce salon${past ? '.' : ' ?'}`,
      createrulessystem: (past, language, roleId) =>
        `${past ? 'créé' : 'créer'} un règlement dans ce salon${roleId !== 'none' ? ` qui donne le rôle <@&${roleId}> si accepté` : ''}${past ? '.' : ' ?'} `,
      createcandidature: (past) =>
        `${past ? 'créé' : 'créer'} une candidature dans ce salon${past ? '.' : ' ?'} `,
      createverificationsystem: (past, language, roleId) =>
        `${past ? 'créé' : 'créer'} un système de vérification dans ce salon qui donne le rôle <@&${roleId}> si passée${past ? '.' : ' ?'} `,
      createpoll: (past, language, phrase) =>
        `${past ? 'créé' : 'créer'} un sondage dans ce salon: "${phrase}"${past ? '.' : ' ?'} `,
      shareannouncement: (past, language, topic) =>
        `${past ? 'partagé' : 'partager'} une annonce dans ce salon: "${topic}"${past ? '.' : ' ?'} `,
      createserver: (past, language, style, font) =>
        `${past ? 'créé' : 'créer'} un serveur${style == 'simple' || style == 'style' ? '' : ' ' + style}${(font == 'normal' || font == 'font') && !isNumericString(font) ? '' : ' avec la font ' + font}${past ? '.' : ' ?'} `,
      createquote: (past) =>
        `${past ? 'créé' : 'créer'} cette citation${past ? '.' : ' ?'} `,
      setupwelcomeandleavechannel: (past) =>
        `${past ? 'configuré' : 'configurer'} le salon de bienvenue et le salon d'au revoir${past ? '.' : ' ? '}`,
      removewelcomesystem: (past) =>
        `${past ? 'supprimé' : 'supprimer'} le système de bienvenue${past ? '.' : ' ?'}`,
      setuprolesmenu: (past) =>
        `${past ? 'configuré' : 'configurer'} le menu des rôles${past ? '.' : ' ?'}`,
      setupautoroles: (past, language, roleId) =>
        `${past ? 'configuré' : 'configurer'} un rôle automatique à l'arrivée dans le serveur avec le rôle <@&${roleId}>${past ? '.' : ' ?'}`,
      creategiveaway: (past, language, duration, reward, winnerCount) =>
        `${past ? 'créé' : 'créer'} un giveaway pour gagner "${reward}" qui dure ${duration} et qui a ${winnerCount} gagnant${winnerCount > 1 ? 's' : ''}${past ? '.' : ' ?'}`,
      setupcreateownvoice: (past) =>
        `${past ? 'configuré' : 'configurer'} le canal pour créer un canal vocal personnalisé${past ? '.' : ' ?'}`,
      changeroomsstyle: (past, language, style) =>
        `${past ? 'modifié' : 'modifier'} le style des salons en ${style}${past ? '.' : ' ?'}`,
      saveserver: (past) =>
        `${past ? 'sauvegardé' : 'sauvegarder'} le serveur${past ? '.' : ' ?'}`,
      restoreserver: (past, guildId) =>
        `${past ? 'restauré' : 'restaurer'} ${guildId === 'none' ? 'ce' : 'le'} serveur${guildId !== 'none' ? ` avec l'ID ${guildId}` : ''}${past ? '.' : ' ?'} `,
      addroletoeveryone: (past, roleId) =>
        `${past ? 'ajouté' : 'ajouter'} le rôle <@&${roleId}> à tous les membres du serveur${past ? '.' : ' ?'} `,
      removeroletoeveryone: (past, roleId) =>
        `${past ? 'enlevé' : 'enlever'} le rôle <@&${roleId}> à tous les membres du serveur${past ? '.' : ' ?'} `,
      purgeroom: (past, roomName) =>
        `${past ? 'purgé' : 'purger'} le salon "${roomName}"${past ? '.' : ' ?'} `,
      purgeall: (past, cible = 'all') => {
        let cibleTxt = '';
        if (cible === 'channels') cibleTxt = ' (salons uniquement)';
        else if (cible === 'roles') cibleTxt = ' (rôles uniquement)';
        else if (cible === 'all' || !cible) cibleTxt = ' (rôles et salons)';
        return `${past ? 'purgé' : 'purger'} le serveur${cibleTxt}${past ? '.' : ' ?'} `;
      },
      transcriptchannel: (past, channelName) =>
        `${past ? 'transcrit' : 'transcrire'} le salon "${channelName}"${past ? '.' : ' ?'} `,
      createcustomembed: (past) =>
        `${past ? 'créé' : 'créer'} un embed personnalisé${past ? '.' : ' ?'} `,
    },
  },
  en: {
    prefix: {
      past: 'I have ',
      present: 'I need to ',
    },
    descriptions: {
      renameuser: (past, userId, newName) =>
        `${past ? 'renamed' : 'rename'} <@${userId}> to "${newName}"${past ? '.' : '?'} `,
      resetusername: (past, userId) =>
        `${past ? 'reset' : 'reset'} <@${userId}> 's nickname${past ? '.' : ' ? '}`,
      createroom: (past, roomName, parent) =>
        `${past ? 'created' : 'create'} a text channel "${roomName.toLowerCase().replaceAll(' ', '-')}" ${parent !== 'none' ? `in "${parent}"` : ''}${past ? '.' : '?'} `,
      createvocal: (past, roomName, parent) =>
        `${past ? 'created' : 'create'} a voice channel "${roomName}" ${parent !== 'none' ? `in "${parent}"` : ''}${past ? '.' : '?'} `,
      createcategory: (past, roomName) =>
        `${past ? 'created' : 'create'} a category "${roomName}"${past ? '.' : '?'} `,
      deleteroom: (past, roomName) =>
        `${past ? 'deleted' : 'delete'} the text channel "${roomName}"${past ? '.' : '?'} `,
      deletevocal: (past, roomName) =>
        `${past ? 'deleted' : 'delete'} the voice channel "${roomName}"${past ? '.' : '?'} `,
      delallroomswiththisname: (past, roomName) =>
        `${past ? 'deleted' : 'delete'} all channels containing "${roomName}" in the name${past ? '.' : '?'} `,
      renameroom: (past, oldroomName, newroomName) =>
        `${past ? 'renamed' : 'rename'} "${oldroomName}" to "${newroomName}"${past ? '.' : '?'} `,
      renameserver: (past, newroomName) =>
        `${past ? 'renamed' : 'rename'} the server to "${newroomName}"${past ? '.' : '?'} `,
      syncpermissionswithcategory: (past, categoryName) =>
        `${past ? 'synchronized' : 'synchronize'} the permissions of all channels in the "${categoryName}" category${past ? '.' : '?'} `,
      createlogsystem: (past) =>
        `${past ? 'created' : 'create'} the logging system${past ? '.' : '?'} `,
      copyemojifromserver: (past, serverId) =>
        `${past ? 'copied' : 'copy'} emojis and stickers from server ${serverId}${past ? '.' : '?'} `,
      deletecategory: (past, roomName) =>
        `${past ? 'deleted' : 'delete'} the category "${roomName}"${past ? '.' : '?'} `,
      renamecategory: (past, oldroomName, newroomName) =>
        `${past ? 'renamed' : 'rename'} the category "${oldroomName}" to "${newroomName}"${past ? '.' : '?'} `,
      moveroom: (past, roomName, categoryName) =>
        `${past ? 'moved' : 'move'} "${roomName}" to "${categoryName}"${past ? '.' : '?'} `,
      banuser: (past, userId, reason) =>
        `${past ? 'banned' : 'ban'} <@${userId}> for: "${reason}"${past ? '.' : '?'} `,
      kickuser: (past, userId, reason) =>
        `${past ? 'kicked' : 'kick'} <@${userId}> for: "${reason}"${past ? '.' : '?'} `,
      unban: (past, userId) =>
        `${past ? 'unbanned' : 'unban'} <@${userId}> ${past ? '.' : '?'} `,
      deletemessage: (past, userId, howMany) =>
        `${past ? 'deleted' : 'delete'} "${howMany}" messages${userId === 'none' ? '' : ` from <@${userId}>`} (not counting this one)${past ? '.' : '?'} `,
      muteuser: (past, userId, reason, duration) =>
        `${past ? 'muted' : 'mute'} <@${userId}> for: "${reason}" for ${formatDuration(duration)}${past ? '.' : '?'} `,
      unmute: (past, userId) =>
        `${past ? 'unmuted' : 'unmute'} <@${userId}> ${past ? '.' : '?'} `,
      createrole: (past, roleName, roleColor, hasAdminPerm) =>
        `${past ? 'created' : 'create'} a role "${roleName}" (#${typeof roleColor === 'string' ? roleColor.replace('#', '') : roleColor}), ${hasAdminPerm === 'true' ? 'with' : 'without'} permissions${past ? '.' : '?'} `,
      deleterole: (past, roleId, message) => {
        const roleName =
          message.guild.roles.cache.get(roleId)?.name || 'unknown';
        return `${past ? 'deleted' : 'delete'} the role "${roleName}"${past ? '.' : '?'} `;
      },
      delallroleswiththisname: (past, roleName) =>
        `${past ? 'deleted' : 'delete'} all roles containing "${roleName}" in the name${past ? '.' : '?'} `,
      changefontserverrooms: (past, language, targetfont) =>
        `${past ? 'changed' : 'change'} the font of all server channels to ${targetfont}${past ? '.' : '?'} `,
      editrolename: (past, roleId, newRoleName) =>
        `${past ? 'renamed' : 'rename'} the role <@&${roleId}> to "${newRoleName}"${past ? '.' : '?'} `,
      editrolecolor: (past, roleId, newRoleColorHex) =>
        `${past ? 'recolored' : 'recolor'} the role <@&${roleId}> to "#${newRoleColorHex.replace('#', '')}"${past ? '.' : '?'} `,
      addroletouser: (past, userId, roleId) =>
        `${past ? 'given' : 'give'} the role <@&${roleId}> to <@${userId}> ${past ? '.' : '?'} `,
      removerolefromuser: (past, userId, roleId) =>
        `${past ? 'removed' : 'remove'} the role <@&${roleId}> from <@${userId}> ${past ? '.' : '?'} `,
      lockyesroom: (past, roomName) =>
        `${past ? 'locked' : 'lock'} the channel "${roomName}"${past ? '.' : '?'} `,
      locknoroom: (past, roomName) =>
        `${past ? 'unlocked' : 'unlock'} the channel "${roomName}"${past ? '.' : '?'} `,
      setroomduration: (past, roomName, duration) =>
        `${past ? 'modified' : 'modify'} the cooldown for the channel "${roomName}" to ${formatDuration(duration)}${past ? '.' : '?'} `,
      createticketsystem: (past) =>
        `${past ? 'created' : 'create'} a ticket system in this channel${past ? '.' : '?'} `,
      createrulessystem: (past, language, roleId) =>
        `${past ? 'created' : 'create'} a rules system in this channel${roleId !== 'none' ? ` that gives the role <@&${roleId}> if accepted` : ''}${past ? '.' : '?'} `,
      createcandidature: (past) =>
        `${past ? 'created' : 'create'} an application form in this channel${past ? '.' : '?'} `,
      createverificationsystem: (past, language, roleId) =>
        `${past ? 'created' : 'create'} a verification system in this channel that gives the role <@&${roleId}> if passed${past ? '.' : '?'} `,
      createpoll: (past, language, phrase) =>
        `${past ? 'created' : 'create'} a poll in this channel: "${phrase}"${past ? '.' : '?'} `,
      shareannouncement: (past, language, topic) =>
        `${past ? 'shared' : 'share'} an announcement in this channel: "${topic}"${past ? '.' : '?'} `,
      createserver: (past, language, style, font) =>
        `${past ? 'created' : 'create'} a server${style == 'simple' || style == 'style' ? '' : ' ' + style}${(font == 'normal' || font == 'font') && !isNumericString(font) ? '' : ' with the font ' + font}${past ? '.' : '?'} `,
      createquote: (past) =>
        `${past ? 'created' : 'create'} this quote${past ? '.' : '?'} `,
      setupwelcomeandleavechannel: (past) =>
        `${past ? 'set up' : 'set up'} the welcome and goodbye channels${past ? '.' : '?'} `,
      removewelcomesystem: (past) =>
        `${past ? 'removed' : 'remove'} the welcome system${past ? '.' : '?'} `,
      setuprolesmenu: (past) =>
        `${past ? 'set up' : 'set up'} the roles menu${past ? '.' : '?'} `,
      setupautoroles: (past, language, roleId) =>
        `${past ? 'set up' : 'set up'} an automatic role on server join with the role <@&${roleId}> ${past ? '.' : '?'} `,
      creategiveaway: (past, language, duration, reward, winnerCount) =>
        `${past ? 'created' : 'create'} a giveaway for "${reward}" lasting ${duration} with ${winnerCount} winner${winnerCount > 1 ? 's' : ''}${past ? '.' : '?'} `,
      setupcreateownvoice: (past) =>
        `${past ? 'set up' : 'set up'} the channel for creating a custom voice channel${past ? '.' : '?'} `,
      changeroomsstyle: (past, language, style) =>
        `${past ? 'changed' : 'change'} the style of channels to ${style}${past ? '.' : '?'} `,
      saveserver: (past) =>
        `${past ? 'saved' : 'save'} the server${past ? '.' : '?'} `,
      restoreserver: (past, guildId) =>
        `${past ? 'restored' : 'restore'} ${guildId === 'none' ? 'this' : 'the'} server${guildId !== 'none' ? ` with ID ${guildId}` : ''}${past ? '.' : '?'} `,
      addroletoeveryone: (past, roleId) =>
        `${past ? 'added' : 'add'} the role <@&${roleId}> to all server members${past ? '.' : '?'} `,
      removeroletoeveryone: (past, roleId) =>
        `${past ? 'removed' : 'remove'} the role <@&${roleId}> to all server members${past ? '.' : '?'} `,
      purgeroom: (past, roomName) =>
        `${past ? 'purged' : 'purge'} the channel "${roomName}"${past ? '.' : '?'} `,
      purgeall: (past) =>
        `${past ? 'purged' : 'purge'} the server(roles and channels)${past ? '.' : '?'} `,
      transcriptchannel: (past, channelName) =>
        `${past ? 'transcribed' : 'transcribe'} the channel "${channelName}"${past ? '.' : '?'} `,
      createcustomembed: (past) =>
        `${past ? 'created' : 'create'} a custom embed${past ? '.' : '?'} `,
    },
  },
};

function detectLanguage(input) {
  const frenchPatterns = [
    /créer/i,
    /supprimer/i,
    /renommer/i,
    /configurer/i,
    /modifier/i,
    /ajouter/i,
    /retirer/i,
    /verrouiller/i,
    /déverrouiller/i,
    /bannir/i,
    /salon/i,
    /serveur/i,
    /rôle/i,
    /utilisateur/i,
    /catégorie/i,
    /transcrire/i,
    /transcrit/i,
  ];

  const englishPatterns = [
    /create/i,
    /delete/i,
    /rename/i,
    /setup/i,
    /modify/i,
    /change/i,
    /add/i,
    /remove/i,
    /lock/i,
    /unlock/i,
    /ban/i,
    /channel/i,
    /server/i,
    /role/i,
    /user/i,
    /category/i,
    /transcribe/i,
    /transcribed/i,
  ];

  let frenchMatches = 0;
  let englishMatches = 0;

  for (const pattern of frenchPatterns) {
    if (pattern.test(input)) frenchMatches++;
  }

  for (const pattern of englishPatterns) {
    if (pattern.test(input)) englishMatches++;
  }

  return englishMatches > frenchMatches ? 'en' : 'fr';
}

async function convertUsernameToId(
  client,
  guildId,
  username,
  useCurrentGuild = false,
  currentGuild = null,
) {
  if (!username || /^\d{17,20}$/.test(username)) {
    return username;
  }

  try {
    const userId = await getGuildMembers(
      client,
      guildId,
      username,
      useCurrentGuild,
      currentGuild,
    );

    const result = userId || username;

    return result;
  } catch {
    return username;
  }
}

async function describeCommands(message, input, pastTense, language, client) {
  if (!language) {
    language = detectLanguage(input);
  }

  const lang = translations[language] || translations.fr;
  const descriptions = lang.descriptions;
  const prefix = lang.prefix[pastTense ? 'past' : 'present'];

  const commands = input
    .replace(/;\s*}/g, '}')
    .replace(/\s*;\s*/g, ';')
    .split(';');
  const userIdCommands = [
    'renameuser',
    'resetusername',
    'banuser',
    'kickuser',
    'unban',
    'deletemessage',
    'muteuser',
    'unmute',
    'addroletouser',
    'removerolefromuser',
  ];
  const currentGuildCommands = [
    'banuser',
    'kickuser',
    'muteuser',
    'unmute',
    'addroletouser',
    'removerolefromuser',
    'renameuser',
    'resetusername',
    'deletemessage',
  ];

  const actions = {};

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];

    const match = command.match(/(\w+)\(([^)]*)\)/);
    if (!match) {
      continue;
    }

    const [, cmd, args] = match;

    let argArray = args
      .split(',')
      .map((arg) => arg.trim().replace(/^["']|["']$/g, ''));

    if (argArray[0] === 'message') {
      argArray.shift();
    }
    if (userIdCommands.includes(cmd)) {
      if (client && message && message.guild) {
        const userIdIndex = getUserIdIndex(cmd);

        if (
          userIdIndex !== -1 &&
          argArray[userIdIndex] &&
          argArray[userIdIndex] !== 'none'
        ) {
          const useCurrentGuild = currentGuildCommands.includes(cmd);

          const convertedId = await convertUsernameToId(
            client,
            message.guild.id,
            argArray[userIdIndex],
            useCurrentGuild,
            useCurrentGuild ? message.guild : null,
          );

          argArray[userIdIndex] = convertedId;
        }
      }
    }
    if (message && message.guild && Array.isArray(argArray)) {
      argArray = argArray.map((arg, index) => {
        if (userIdCommands.includes(cmd) && index === getUserIdIndex(cmd)) {
          return arg;
        }

        if (/^\d{17,20}$/.test(arg)) {
          const ch = message.guild.channels.cache.get(arg);
          if (ch) {
            return ch.name;
          }
        }
        return arg;
      });
    }

    const descriptionFn = descriptions[cmd];
    if (descriptionFn) {
      actions[cmd] = actions[cmd] || [];
      const description = descriptionFn(pastTense, ...argArray, message);

      actions[cmd].push(description);
    } else {
      actions.unknown = actions.unknown || [];

      actions.unknown.push(
        "Je n'ai pas très bien compris votre demande, reformulez-la, s'il-vous-plaît",
      );
    }
  }

  const output = Object.entries(actions)
    .map(([type, actions]) => {
      if (type === 'unknown') return actions.join('\n');
      return actions.length === 1 ?
          `${prefix}${actions[0]} `
        : `${prefix}: \n${actions.map((action) => `- ${action}`).join('\n')} `;
    })
    .join('\n');

  const finalOutput = pastTense ? output.replace(' ?', '.') + `￶` : output;

  return finalOutput;
}

function getUserIdIndex(command) {
  const userIdIndexMap = {
    renameuser: 0,
    resetusername: 0,
    banuser: 0,
    kickuser: 0,
    unban: 0,
    deletemessage: 0,
    muteuser: 0,
    unmute: 0,
    addroletouser: 0,
    removerolefromuser: 0,
  };

  return userIdIndexMap[command] ?? -1;
}

export { describeCommands };

