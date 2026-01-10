import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sansAccents = (str) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function detectAntiRaidKeywords(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }

  try {
    const normalizedContent = sansAccents(content.toLowerCase());

    const hasAnti = normalizedContent.includes('anti');
    const hasRaid = normalizedContent.includes('raid');
    const hasNuke = normalizedContent.includes('nuke');

    return hasAnti && (hasRaid || hasNuke);
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'detectAntiRaidKeywords',
      step: 'detection',
      component: 'antiRaidResponses',
    });
    triggerErrorEmbed(error, null, null);
    return false;
  }
}

function getAntiRaidResponse(language = 'fr') {
  try {
    const responses = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          '..',
          'locales',
          language,
          'responses',
          'antiraid.json',
        ),
        'utf8',
      ),
    );
    const randomIndex = Math.floor(Math.random() * responses.responses.length);
    return responses.responses[randomIndex];
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'getAntiRaidResponse',
      step: 'response_generation',
      component: 'antiRaidResponses',
    });
    triggerErrorEmbed(error, null, null);
    return 'Je ne peux pas aider avec ce type de demande.';
  }
}

export { detectAntiRaidKeywords, getAntiRaidResponse };

