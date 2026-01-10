const antiRaidKeywordsArray = [
  'anti-raid',
  'protection',
  'sécurité',
  'raid protection',
  'anti-nuke',
  'antiraid',
  'anti raid',
  'raid protect',
  'anti-bot',
  'antibot',
];

const antiRaidResponseCache = new Map();

function detectAntiRaidKeywords(content) {
  const contentLower = content.toLowerCase();

  for (let i = 0; i < antiRaidKeywordsArray.length; i++) {
    if (contentLower.includes(antiRaidKeywordsArray[i])) {
      return true;
    }
  }
  return false;
}

function getAntiRaidResponse(language) {
  if (antiRaidResponseCache.has(language)) {
    return antiRaidResponseCache.get(language);
  }

  const response =
    language === 'en' ?
      'I have built-in anti-raid and anti-nuke protection with advanced ID validation. No configuration needed - I handle everything automatically and securely.'
    : "J'ai une protection anti-raid et anti-nuke intégrée avec validation avancée des IDs. Pas besoin de configuration - je gère tout automatiquement et en sécurité.";

  antiRaidResponseCache.set(language, response);
  return response;
}

export { detectAntiRaidKeywords, getAntiRaidResponse };

