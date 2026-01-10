import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LANGUAGE_PATTERNS = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../data/languagePatterns.json'),
    'utf8',
  ),
);
const countPatternMatches = (t, p) =>
  p.reduce((c, x) => (t.includes(x) ? c + 1 : c), 0);
export { countPatternMatches, LANGUAGE_PATTERNS };

