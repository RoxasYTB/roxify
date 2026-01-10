import fs from 'fs';
import path from 'path';
const directoryPath = '/home/ysannier/Glados-Disc';
let treeStructure = {};
let totalLines = 0,
  totalSize = 0;
async function countLinesInFile(filePath) {
  if (!filePath || typeof filePath !== 'string' || !filePath.endsWith('.js'))
    return {
      lines: 0,
      size: 0,
    };

  try {
    await fs.promises.access(filePath);
  } catch {
    return {
      lines: 0,
      size: 0,
    };
  }

  try {
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    const lineCount = fileContent.split('\n').length;
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;

    totalSize += fileSize;
    totalLines += lineCount;

    return {
      lines: lineCount,
      size: fileSize,
    };
  } catch {
    return {
      lines: 0,
      size: 0,
    };
  }
}
async function buildDirectoryTree(directory, tree = {}) {
  const ignored = [
    'node_modules',
    '.git',
    '.github',
    '.eslintrc',
    '.gitignore',
    '.pre-commit-config.yaml',
    'package.json',
    'package-lock.json',
  ];
  const allItems = await fs.promises.readdir(directory);
  const itemsWithStats = await Promise.all(
    allItems
      .filter((f) => !ignored.includes(f))
      .map(async (f) => {
        const filePath = path.join(directory, f);
        const stat = await fs.promises.stat(filePath);
        return { name: f, isDirectory: stat.isDirectory() };
      }),
  );
  const items = itemsWithStats
    .sort((a, b) => {
      return (
        a.isDirectory && !b.isDirectory ? -1
        : !a.isDirectory && b.isDirectory ? 1
        : a.name.localeCompare(b.name)
      );
    })
    .map((item) => item.name);
  for (const file of items) {
    const filePath = path.join(directory, file);
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      const rel = filePath.replace(directoryPath, '');
      tree[rel] = {
        type: 'directory',
        items: {},
        lines: 0,
        size: 0,
      };
      await buildDirectoryTree(filePath, tree[rel].items);
    } else if (stat.isFile() && file.endsWith('.js')) {
      const { lines, size } = await countLinesInFile(filePath);
      tree[filePath.replace(directoryPath, '')] = {
        type: 'file',
        lines,
        size,
      };
    }
  }
  return tree;
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
    const sizeInKB = (totalSize / 1024).toFixed(2),
      sizeInMB = (totalSize / (1024 * 1024)).toFixed(2),
      sizeInGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2);
    let sizeMessage = `${sizeInKB} KB`;
    if (sizeInMB > 1) sizeMessage += ` (${sizeInMB} MB)`;
    if (sizeInGB > 1) sizeMessage += ` (${sizeInGB} GB)`;
    return {
      totalLines,
      sizeMessage,
    };
  } catch {
    return {
      totalLines: 0,
      sizeMessage: '0 KB',
    };
  }
}
export { getFilesInfos };

