const server = (g, u) => [
  `Actuellement, je suis présente sur ${g} serveurs, et je suis utilisée par ${u} utilisateurs.`,
  `Je suis déployée sur ${g} serveurs, servant ainsi ${u} utilisateurs.`,
  `À l'heure actuelle, ${g} serveurs bénéficient de mes services, avec un total de ${u} utilisateurs.`,
  `Je suis active sur ${g} serveurs, ce qui me permet d'interagir avec ${u} utilisateurs.`,
  `Vous pouvez me retrouver sur ${g} serveurs, où j'assiste ${u} utilisateurs.`,
  `Mon réseau s'étend sur ${g} serveurs, touchant un total de ${u} utilisateurs.`,
  `Je suis fière de faire partie de ${g} communautés de serveurs, où j'aide ${u} personnes.`,
  `Je suis hébergée sur ${g} serveurs et je suis là pour aider ${u} utilisateurs.`,
  `J'opère actuellement sur ${g} serveurs, offrant mes services à ${u} utilisateurs.`,
  `Je suis connectée à ${g} serveurs, ce qui représente un total de ${u} utilisateurs que je peux assister.`,
];

const insolence = [
  `C'est une technique pour vous faire réagir. En titillant l'égo des gens, ils ont 95% de chances de répondre, et moi je répondrai à 100%, ce qui rendra le serveur plus actif.`,
  "Je suis conçu pour provoquer des réactions. En piquant l'égo des utilisateurs, ils sont plus enclins à répondre, ce qui rend le serveur plus actif.",
  "L'insolence est une stratégie pour stimuler les discussions. En provoquant les membres, ils sont plus susceptibles de répondre, ce qui maintient l'activité du serveur.",
  'Mon insolence est calculée pour encourager les interactions. En défiant les utilisateurs, ils sont plus enclins à répondre, ce qui aide à maintenir le serveur actif.',
  'Être insolent est une méthode pour susciter des réponses. En provoquant les utilisateurs, ils sont plus susceptibles de réagir, ce qui aide à garder le serveur actif.',
  "L'insolence est un moyen de susciter des échanges. En piquant l'égo des gens, ils sont plus enclins à répondre, ce qui rend le serveur plus actif.",
  "Je suis programmé pour provoquer des réactions. En titillant l'égo des utilisateurs, ils sont plus enclins à répondre, ce qui rend le serveur plus actif.",
  "L'insolence est une stratégie pour stimuler les conversations. En provoquant les utilisateurs, ils sont plus susceptibles de répondre, ce qui maintient l'activité du serveur.",
  'Mon insolence est calculée pour encourager les interactions. En défiant les utilisateurs, ils sont plus enclins à répondre, ce qui aide à maintenir le serveur actif.',
  'Être insolent est une méthode pour susciter des réponses. En provoquant les utilisateurs, ils sont plus susceptibles de réagir, ce qui aide à garder le serveur actif.',
];

let serverResponseCache = null;
let lastServerResponseTime = 0;
const SERVER_CACHE_DURATION = 60000;

const getServerCountResponse = (guildCount, userCount) => {
  const now = Date.now();

  if (
    serverResponseCache &&
    now - lastServerResponseTime < SERVER_CACHE_DURATION &&
    serverResponseCache.guildCount === guildCount &&
    serverResponseCache.userCount === userCount
  ) {
    return serverResponseCache.response;
  }

  const responses = server(guildCount, userCount);
  const selectedResponse =
    responses[Math.floor(Math.random() * responses.length)];

  serverResponseCache = {
    guildCount,
    userCount,
    response: selectedResponse,
  };
  lastServerResponseTime = now;

  return selectedResponse;
};

const getInsolenceResponse = () => {
  return insolence[Math.floor(Math.random() * insolence.length)];
};

export { getInsolenceResponse, getServerCountResponse };

