import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = {};
async function load(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      await load(fullPath);
    } else if (item.endsWith('.js')) {
      try {
        const relativePath =
          './' + path.relative(__dirname, fullPath).replace(/\\/g, '/');
        const mod = await import(relativePath);
        const name = path.basename(item, '.js');
        if (typeof mod[name] === 'function') commands[name] = mod[name];
      } catch (error) {
        console.warn(`Could not load command from ${fullPath}:`, error.message);
      }
    }
  }
}

await load('./commands');
export default commands;

