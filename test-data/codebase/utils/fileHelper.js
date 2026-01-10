import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { colors, log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', 'config', 'loggerConfig.json');
const { messages: configMessages } = JSON.parse(
  fs.readFileSync(configPath, 'utf8'),
);

async function ensureDirectoryExists(dirPath) {
  try {
    await fs.promises.access(dirPath);
  } catch {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }
}

function processFileList(files, logFunction) {
  files.forEach((file, index) => {
    let prefix;
    if (index === 0) prefix = configMessages.fileProcessedPrefixStart;
    else if (index === files.length - 1)
      prefix = configMessages.fileProcessedPrefixEnd;
    else prefix = configMessages.fileProcessedPrefixMiddle;

    logFunction(
      colors.BRIGHT_CYAN,
      `${prefix} \x1b[${colors.WHITE} m  \x1b[${colors.BRIGHT_GREEN}m${configMessages.fileProcessedOk} \x1b[${colors.WHITE}m${file.padEnd(85)} \x1b[${colors.BRIGHT_GREEN}m${configMessages.fileProcessedSuffixOk}`,
    );
  });
}

function getJsFilesRecursively(baseDir) {
  const files = [];
  const fullBaseDir = path.join(__dirname, '..', baseDir);
  if (!fs.existsSync(fullBaseDir)) return;
  (function scan(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    fs.readdirSync(currentDir, {
      withFileTypes: true,
    }).forEach((item) => {
      const fullPath = path.join(currentDir, item.name);
      if (item.isDirectory()) scan(fullPath);
      else if (item.name.endsWith('.js')) files.push(fullPath);
    });
  })(fullBaseDir);
  processFileList(files, log);
}

async function getFilesInfos() {
  try {
    totalLines = 0;
    totalSize = 0;
    treeStructure = {};
    try {
      await fs.promises.access(directoryPath);
    } catch {
      return {
        totalLines: 0,
        sizeMessage: '0 KB',
      };
    }
    await buildDirectoryTree(directoryPath, treeStructure);
  } catch {}
}

export { ensureDirectoryExists, getFilesInfos, getJsFilesRecursively };

