import WhiteList from '../../whitelist.json' with { type: 'json' };
import { generateKeys } from '../RSA.js';

export default async function regenerateRSAKeys(m) {
  if (WhiteList.KeysOwners.includes(m.author.id)) {
    try {
      await generateKeys();
      return m.reply('Les clés RSA ont été générés avec succès !');
    } catch (error) {
      console.log('Erreur lors de la génération des clés RSA :' + error);
    }
  } else {
    return m.reply(
      `Vous n'avez pas les permissions, cela ne vous regarde pas !`,
    );
  }
}
