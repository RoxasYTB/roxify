import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', 'config', 'loggerConfig.json');
const {
  colors,
  messages,
  errors: errorMessages,
} = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function log(color, message, partsSeparator = true) {
  if (message === '' && partsSeparator) return console.log('');
  if (partsSeparator) {
    if (typeof message !== 'string')
      return console.log(`\x1b[${color}m${message}\x1b[0m`);
    const [first, ...rest] = message.split(' ');
    console.log(
      `\x1b[${color}m${first} \x1b[${colors.WHITE}m${rest.join(' ')}`,
    );
  } else {
    console.log(`\x1b[${color}m${message}\x1b[0m`);
  }
}

function logMessage(key, color = colors.WHITE, replacements = {}) {
  let message = messages[key] || errorMessages[key] || key;
  for (const placeholder in replacements) {
    message = message.replace(`{${placeholder}}`, replacements[placeholder]);
  }
  log(color, message);
}

function logHeader(titleKey, borderColor = colors.BRIGHT_CYAN) {
  const title = messages[titleKey] || titleKey;
  log(borderColor, messages.deployCommandsHeaderTop, false);
  process.stdout.write(`\x1b[${borderColor}m${title}\x1b[${borderColor}m║\n`);
  log(borderColor, messages.deployCommandsHeaderBottom, false);
  console.log('');
}

function logColoredMessage(message) {
  message = message.replace(/={30,}/g, `\x1b[${colors.GRAY}m$&\x1b[0m`);

  message = message.replace(
    /\[GUILD\]/g,
    `\x1b[${colors.BRIGHT_RED}m[GUILD]\x1b[0m`,
  );
  message = message.replace(
    /\[MEMBERS\]/g,
    `\x1b[${colors.ORANGE}m[MEMBERS]\x1b[0m`,
  );
  message = message.replace(
    /\[USER\]/g,
    `\x1b[${colors.BRIGHT_YELLOW}m[USER]\x1b[0m`,
  );
  message = message.replace(
    /\[INVITE\]/g,
    `\x1b[${colors.BRIGHT_GREEN}m[INVITE]\x1b[0m`,
  );
  message = message.replace(
    /\[CHANNEL\]/g,
    `\x1b[${colors.BRIGHT_CYAN}m[CHANNEL]\x1b[0m`,
  );
  message = message.replace(
    /\[CONTENT\]/g,
    `\x1b[${colors.BRIGHT_BLUE}m[CONTENT]\x1b[0m`,
  );

  message = message.replace(/\(ID: \d+\)/g, `\x1b[${colors.GRAY}m$&\x1b[0m`);

  message = message.replace(
    /(https?:\/\/[^\s]+)/g,
    `\x1b[${colors.WHITE}m$1\x1b[0m`,
  );

  console.log(message);
}

export { colors, log, logColoredMessage, logHeader, logMessage };

