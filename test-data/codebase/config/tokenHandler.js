import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import loadEnv from './loadEnv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();

function getDiscordToken() {
  const env = process.env.ENV?.toUpperCase() || 'PROD';
  let token;

  if (env === 'DEV') {
    token = process.env.DISCORD_TOKEN;
  } else if (env === 'PROD') {
    try {
      const tokenPaths = [
        path.resolve(__dirname, 'token.json'),
        path.resolve(__dirname, '..', 'config', 'token.json'),
        path.resolve('./config/token.json'),
        path.resolve('C:/Users/token.json'),
        path.resolve('/home/ysannier/token.json'),
      ];

      let configFound = false;
      for (const configPath of tokenPaths) {
        try {
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            token = config.token;
            configFound = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!configFound) {
        console.error(
          '❌ Impossible de lire le token en PROD (fichier manquant).',
        );
        console.error('Chemins essayés:', tokenPaths);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Erreur lors de la lecture du token:', error.message);
      process.exit(1);
    }
  } else {
    throw new Error(`Environnement inconnu: ${env}. Utilisez "DEV" ou "PROD".`);
  }

  if (typeof token === 'string') {
    token = token.trim();
    if (token.toLowerCase().startsWith('bot ')) {
      token = token.slice(4).trim();
    }

    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1).trim();
    }
  }

  if (!token) {
    const err = new Error('Token Discord manquant');
    console.error('❌ Aucun token Discord trouvé !');
    console.error('📝 Vérifiez votre .env ou votre fichier token.json');

    triggerErrorEmbed(err, {
      action: 'loadToken',
      step: 'env_fallback',
      error: err,
    });
    process.exit(1);
  }
  if (token.length < 50) {
    console.error('❌ Token Discord invalide ou trop court');
    console.error(`Longueur: ${token.length} caractères`);
    console.error(
      '💡 Un token Discord valide fait généralement entre 50 et 70 caractères',
    );
    process.exit(1);
  }

  if (!/^[A-Za-z0-9._\-/+=]+$/.test(token)) {
    console.error('❌ Token Discord contient des caractères invalides.');
    console.error(
      'Le token peut contenir: lettres, chiffres, ., _, -, /, +, =',
    );
    process.exit(1);
  }

  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) {
    console.error('❌ Format de token Discord invalide.');
    console.error(
      '💡 Un token Discord doit avoir le format: BOT_ID.TIMESTAMP.HMAC (3 parties séparées par des points)',
    );
    console.error(`Format reçu: ${tokenParts.length} parties`);
    process.exit(1);
  }

  return token;
}

export default getDiscordToken;

