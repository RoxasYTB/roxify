import { PermissionsBitField } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const P = PermissionsBitField.Flags;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const raw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../data/commandPermissions.json'),
    'utf8',
  ),
);
const commandPermissions = {};
for (const k in raw) {
  const [legacy, bitfield] = raw[k];
  commandPermissions[k] = {
    legacy,
    bitfield: [P[bitfield]],
  };
}
export { commandPermissions };

