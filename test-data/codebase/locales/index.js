import fs from 'fs';
import path from 'path';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const translationsCache = {};

function t(key, language = 'fr', replacements = {}) {
  if (!key) {
    return '';
  }

  try {
    const lang = (language || 'fr').trim();
    const parts = key.split('.');
    const fileName = parts[0];
    const filePath = path.resolve(__dirname, lang, `${fileName}.json`);

    if (!(translationsCache[lang] && translationsCache[lang][fileName])) {
      if (!fs.existsSync(filePath)) {
        if (lang !== 'fr') {
          return t(key, 'fr', replacements);
        }
        return key;
      }
      if (!translationsCache[lang]) {
        translationsCache[lang] = {};
      }
      translationsCache[lang][fileName] = JSON.parse(
        fs.readFileSync(filePath, 'utf8'),
      );
    }

    const translations = translationsCache[lang][fileName];

    let result = translations;
    for (let i = 1; i < parts.length; i++) {
      if (result && result[parts[i]] !== undefined) {
        result = result[parts[i]];
      } else {
        return key;
      }
    }

    if (typeof result === 'string') {
      return Object.entries(replacements).reduce(
        (str, [key, value]) =>
          str.replace(new RegExp(`\\{${key}\\}`, 'g'), value),
        result,
      );
    }

    return result;
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'locales-t',
      key,
      language,
    });
    return key;
  }
}

function getNestedTranslation(path, language = 'fr') {
  return t(path, language);
}

const embeddedContentCache = {};

function getEmbeddedContent(category, type, language = 'fr') {
  if (!category || !type) {
    return null;
  }

  try {
    const lang = language || 'fr';
    const cacheKey = `${lang}_${category}_${type}`;

    if (embeddedContentCache[cacheKey]) {
      return embeddedContentCache[cacheKey];
    }

    const filePath = path.resolve(
      __dirname,
      lang,
      'embeds',
      category,
      `${type}.json`,
    );

    if (!fs.existsSync(filePath)) {
      if (lang !== 'fr') {
        return getEmbeddedContent(category, type, 'fr');
      }
      return null;
    }

    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    embeddedContentCache[cacheKey] = content;
    return content;
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'locales-getEmbeddedContent',
      language,
      category,
      type,
    });
    return null;
  }
}

export { getEmbeddedContent, getNestedTranslation, t };

