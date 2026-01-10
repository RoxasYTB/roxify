class OptimizedLanguageLRUCache {
  constructor(maxSize = 2000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

const languageDetectionCache = new OptimizedLanguageLRUCache(2000);

const frenchWordsSet = new Set([
  'le',
  'la',
  'les',
  'de',
  'du',
  'des',
  'et',
  'ou',
  'est',
  'avec',
  'dans',
  'pour',
  'sur',
  'par',
  'sans',
  'sous',
  'ce',
  'que',
  'qui',
  'une',
  'un',
  'il',
  'elle',
  'nous',
  'vous',
  'ils',
  'elles',
]);

const englishWordsSet = new Set([
  'the',
  'and',
  'or',
  'is',
  'with',
  'in',
  'for',
  'on',
  'by',
  'without',
  'under',
  'of',
  'to',
  'a',
  'an',
  'this',
  'that',
  'he',
  'she',
  'we',
  'you',
  'they',
  'it',
]);

function detectLanguage(content) {
  if (!content || content.length < 3) return 'fr';

  const cached = languageDetectionCache.get(content);
  if (cached) return cached;

  const words = content.toLowerCase().split(/\s+/);
  let frenchCount = 0;
  let englishCount = 0;

  const maxWords = Math.min(words.length, 15);

  for (let i = 0; i < maxWords; i++) {
    const word = words[i];
    if (frenchWordsSet.has(word)) frenchCount++;
    if (englishWordsSet.has(word)) englishCount++;

    if (i > 5 && Math.abs(frenchCount - englishCount) > 3) break;
  }

  const result = englishCount > frenchCount ? 'en' : 'fr';
  languageDetectionCache.set(content, result);
  return result;
}

const sansAccents = (str) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export { OptimizedLanguageLRUCache, detectLanguage, sansAccents };

