export const combRegex = /comb|comn/;
export const servRegex = /serv/;
export const insoRegex = /inso|mecha|clash/;
export const blaguRegex = /blagu/;

export const VILIGUE_SERVER_ID = '1272160243706626100';
export const VILIGUE_COMMAND_CHANNEL_ID = '1397599098823245864';

import jokes from '../utils/jokes.json' with { type: 'json' };

export const getRandomJoke = () => {
  return jokes[Math.floor(Math.random() * jokes.length)];
};

export const LINK_KEYS = [
  'actionListFunctionFr',
  'actionListFunctionEn',
  'websiteLink',
  'presentationVideo',
  'supportLink',
  'addLink',
  'instagramLink',
  'nitro',
  'codage',
  'bdd',
  'serverInfo',
  'joinvoicechannel',
  'leavevoicechannel',
];

export const createHeaders = () => ({
  'Content-Type': 'application/json',
  ...(process.env.LLM_API_KEY && {
    Authorization: `Bearer ${process.env.LLM_API_KEY}`,
  }),
});


