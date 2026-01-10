import { LANGUAGE_PATTERNS, countPatternMatches } from './languagePatterns.js';

function detectLanguage(t) {
  const l = t.toLowerCase(),
    n = t.split(' ').length,
    f = countPatternMatches(l, LANGUAGE_PATTERNS.fr),
    e = countPatternMatches(l, LANGUAGE_PATTERNS.en);
  return (e / n) * 100 > (f / n) * 100 ? 'en' : 'fr';
}

export { detectLanguage };

