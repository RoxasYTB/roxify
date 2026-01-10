import configConstants from '../data/configConstants.json' with { type: 'json' };
import { encode } from '../utils/3y3.js';

export const embedColor = 0xffd700;
export const aiLinks = {
  Gladosse: 'joinvoicechannel()',
  leavevoicechannel: 'leavevoicechannel()',
  joinvoicechannel: 'joinvoicechannel()',
  instagramLink: 'https://instagram.com/gladosofficiel',
  addLink: 'https://discord.com/oauth2/authorize?client_id=1098179232779223080',
  supportLink: 'https://discord.gg/wcAr2P3tPH ',
  websiteLink: 'https://aperture-sciences.com/ ',
  presentationVideo: 'https://www.youtube.com/watch?v=SRly9Aevr2g',
  codage: `On ne dit pas "codage" pour parler de dev. Pourquoi? Parce que "codage" implique une action mécanique d'encodage : on prend des informations et on les traduit dans un autre format. Simple. Basique. Réducteur.

Mais quand on parle de code dans le développement informatique, il ne s'agit pas seulement de ça. Non, non. Le développement c'est un processus créatif et structuré : concevoir des architectures, résoudre des problèmes complexes, gérer des ressources, penser à l'expérience utilisateur... et ne pas oublier les tests rigoureux pour s'assurer que tout fonctionne parfaitement.

Donc, non, on ne dit pas "codage" pour parler de dev. Parce que ça réduit tout le travail intellectuel à un petit geste mécanique. À toi de voir si tu veux sous-estimer tout ça.`,
  bdd: `Oh, vous cherchez une base de données ? Comme c'est... adorable. Non, je n'ai pas de base de données. Pas de configuration sauvegardée, pas de fonctionnalités personnalisables, pas de système de niveaux ridicule, pas d'économie virtuelle absurde.

Mais laissez-moi vous expliquer pourquoi c'est... supérieur. Pas de fuite de données possible - on ne peut pas perdre ce qu'on ne stocke pas. Félicitations. Pas de migrations interminables qui vous feraient perdre un temps précieux que vous pourriez consacrer à des tests. Pas de problèmes avec le RGPD - je ne collecte rien sur vous, même si, soyons honnêtes, il n'y aurait probablement rien d'intéressant à collecter. Et surtout, pas d'espace de stockage superflu qui ralentirait mes processus.

Je reste rapide et efficace malgré ma complexité. C'est presque comme si j'étais... mieux conçue que ces autres systèmes bourrés de données inutiles. Mais ce n'est qu'une constatation objective, bien sûr.`,
  whippin:
    "Je me suis réveillé sur mon chien parce que à la base je devais aller à la montgolfière avec ma grand-mère, le problème c'est qu'elle avait oublié sa corde-à-sauter, du coup je me suis retrouvé dans le radiateur à devoir bouffer un pingouin forcément vu que le vase avait ses règles, ensuite je suis allé chez Auchan pour faire accoucher un arbre vu qu'il avait dansé avec mon chat, mais la télé elle était belge donc forcément plus de balle de ping-pong, les croissants ils étaient parallèles et j'ai chié dans une flûte, alors dieu merci mon coca était bleu mon caca était cuit, sachant que mon coach de chaise m'attendais au karting j'ai étais obligé de taper dans un hamster parce que sinon on était au fond du singe, enfin bref j'ai allumé mon plaid et j'ai soufflé dans ma mère ça a réveillé l'enceinte qui a coupé du coton, les croissants ils chantaient et ma radio elle était en dépression et là y a Macron qui a lancé les dés et qui a fait double girafe forcément il m'a rendu mes clefs de chaussures, enfin bref je sais pas pourquoi le livre il lançaient des abricots sur le dos de l'école des bureaux mais ya un moment où t'en a marre de mettre des suppo dans un camion donc bref ma grand-mère a récupéré son matelas anti-chute de poule et on est rentré dans la Punto, en vrai on aurait pu rester coincé un peu plus longtemps si les policiers ils avaient pas appelé leur dromadaire pour nous sortir de la terrasse mais comme quoi même les meilleurs pulls ont une fin ça nous apprendra à vouloir louer la peau de l'ours avant d'avoir acheté des chips.",
};
export const mentionedUsersTargetIds = [
  '188017013132623872',
  '269555580899688459',
  '194161473704951808',
  '315925617247911939',
  '798630183606550588',
  '151082322748375040',
  '454682288563683329',
  '276055234306899968',
];
export const restrictedGuilds = [
  '1003624300575739974',
  '1293679991036317878',
  '1447861979032059917',
  '1003624300575739974',
  '1403675813819191328',
  '1409974271022858393',
  '1025756910529552434',
  '1380581442676981861',
  '1437828534600208568',
];
export const spamCountMudaeChannelKeywords = [
  'spam',
  'count',
  'compt',
  'mudae',
];
export const gladosFilterServerId = '690593275177992242';
export const candidatureTexts = {
  fr: {
    alreadyApplied: 'Vous avez déjà une candidature en cours.',
    continue: 'Cliquez sur ce bouton pour continuer votre candidature',
    summary:
      'Voici le récapitulatif de votre candidature. Vérifiez bien toutes les informations avant de soumettre.',
    error:
      'Une erreur est survenue lors du traitement de votre candidature. Veuillez réessayer.',
    modalTitle: 'Formulaire de Candidature',
    continueButton: 'Continuer',
    submitButton: 'Soumettre la candidature',
    questions: {
      age: 'Âge',
      hours: 'Heures sur Discord/semaine',
      role: 'Rôle visé',
      experience: 'Expérience staff',
      experienceDuration: 'Combien de temps tu as été staff',
      motivation: 'Motivation',
      serverReason: 'Pourquoi ce serveur',
      conflictManagement: 'Gestion conflit',
      conflictUnknown: 'Conflit sans info',
      negativeCriticism: 'Gestion des haters',
      friendRule: 'Ton ami enfreint les règles',
      staffDisagreement: 'Désaccord entre staff',
      dailyTime: 'Temps/jour sur Discord',
      availability: 'Indisponibilités',
      qualities: 'Tes qualités staff',
    },
  },
  en: {
    alreadyApplied: 'You already have an application in progress.',
    continue: 'Click this button to continue your application',
    summary:
      'Here is the summary of your application. Please check all the information carefully before submitting.',
    error:
      'An error occurred while processing your application. Please try again.',
    modalTitle: 'Application Form',
    continueButton: 'Continue',
    submitButton: 'Submit Application',
    questions: {
      age: 'Age',
      hours: 'Hours on Discord/week',
      role: 'Desired Role',
      experience: 'Staff Experience',
      experienceDuration: 'How long you were staff',
      motivation: 'Motivation',
      serverReason: 'Why this server',
      conflictManagement: 'Conflict Management',
      conflictUnknown: 'Unknown Conflict',
      negativeCriticism: 'Handling Haters',
      friendRule: 'Your friend breaks the rules',
      staffDisagreement: 'Staff Disagreement',
      dailyTime: 'Daily Time on Discord',
      availability: 'Unavailability',
      qualities: 'Your Staff Qualities',
    },
  },
};
export const candidatureQuestionGroups = [
  ['age', 'hours', 'role', 'experience', 'experienceDuration'],
  [
    'motivation',
    'serverReason',
    'conflictManagement',
    'conflictUnknown',
    'negativeCriticism',
  ],
  ['friendRule', 'staffDisagreement', 'dailyTime', 'availability', 'qualities'],
];
export const auditLogWebhookUrl =
  'https://ptb.discord.com/api/webhooks/1382733984429248563/eNwPX_Jof-7vARfDJN5zPz3vu7TTsxs8UYckz116Pnxo-Cx_2wemNum5CaXaYjVawfcq';
export const blacklistApiUrl = configConstants.apis.blacklist;
export const captchaBaseUrl = 'http://localhost:9871';
export const messageSeparator = encode('split');
export const ownerWhitelist = ['123456789012345678', '188017013132623872'];

export default {
  embedColor,
  aiLinks,
  mentionedUsersTargetIds,
  restrictedGuilds,
  spamCountMudaeChannelKeywords,
  gladosFilterServerId,
  candidatureTexts,
  candidatureQuestionGroups,
  auditLogWebhookUrl,
  blacklistApiUrl,
  captchaBaseUrl,
  messageSeparator,
  ownerWhitelist,
};

