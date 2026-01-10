import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const handlers = {};

async function loadHandlers() {
  const files = fs
    .readdirSync(path.join(__dirname, 'interactions'))
    .filter((f) => f.endsWith('.js') && f !== 'index.js');

  for (const file of files) {
    try {
      const mod = await import(`./interactions/${file.slice(0, -3)}.js`);
      const key = file.slice(0, -3);
      handlers[key] = mod[key] || mod[Object.keys(mod)[0]];
    } catch (error) {
      console.error(`Erreur lors du chargement de ${file}:`, error);
    }
  }
}

await loadHandlers();

export default handlers;

