import axios from 'axios';
import * as cheerio from 'cheerio';
import { cacheGet, cacheSet } from './coreUtils.js';

async function fetchMetadata(urls, messageContent, translateInto) {
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return '';
  }

  const cacheKey = `metadata_${urls.join('_')}_${translateInto}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const metadata = {};
  const promises = urls.map(async (url) => {
    try {
      const response = await axios.get(url, {
        timeout: 5000,
      });
      const $ = cheerio.load(response.data);
      const title =
        $("meta[property='og:title']").attr('content') ||
        $('title').text() ||
        '';
      const description =
        $("meta[property='og:description']").attr('content') || '';
      return { title, description };
    } catch {
      return { title: '', description: '' };
    }
  });

  const results = await Promise.allSettled(promises);
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      const { title, description } = result.value;
      if (translateInto) {
        metadata[translateInto] = {
          fr: `Peux-tu me donner un commentaire moqueur sur la demande suivante : ${messageContent} , y compris les métadonnées du titre '${title} ' et la description '${description} '. Ne partage aucun lien et ne mentionne pas explicitement cette demande.`,
        };
      }
    }
  });

  const result = metadata[translateInto] ? metadata[translateInto].fr : '';
  cacheSet(cacheKey, result, 300000);
  return result;
}

export { fetchMetadata };

