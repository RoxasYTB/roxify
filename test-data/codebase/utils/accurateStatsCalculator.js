import fs from 'fs';
import path from 'path';
import readline from 'readline';

class AccurateStatsCalculator {
  constructor(customPath = null) {
    const DEFAULT_TARGET_DIR = '/home/ysannier/Glados-Disc';
    this.directoryPath = customPath || DEFAULT_TARGET_DIR;
    this.targetExists = fs.existsSync(this.directoryPath);

    this.treeStructure = {};
    this.totalLines = 0;
    this.totalSize = 0;
    this.fileStats = [];
  }

  async countLinesInFile(filePath) {
    if (!filePath.endsWith('.js')) {
      return {
        lines: 0,
        size: 0,
      };
    }

    try {
      let lineCount = 0;
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      rl.on('line', () => {
        lineCount++;
      });

      await new Promise((resolve) => rl.on('close', resolve));

      const fileSize = fs.statSync(filePath).size;
      this.totalSize += fileSize;
      this.totalLines += lineCount;

      this.fileStats.push({
        path: filePath,
        lines: lineCount,
        size: fileSize,
      });

      return {
        lines: lineCount,
        size: fileSize,
      };
    } catch (error) {
      console.warn(
        `[STATS] Erreur lors du calcul de ${filePath}:`,
        error.message,
      );
      return {
        lines: 0,
        size: 0,
      };
    }
  }

  async buildDirectoryTree(directory, tree = {}) {
    try {
      const files = fs.readdirSync(directory);
      const ignoredItems = [
        'node_modules',
        '.git',
        '.github',
        '.eslintrc',
        '.gitignore',
        '.pre-commit-config.yaml',
        'package.json',
        'package-lock.json',
        '.vscode',
        'dist',
        'build',
      ];

      const items = files
        .filter((file) => !ignoredItems.includes(file))
        .sort((a, b) => {
          const aPath = path.join(directory, a);
          const bPath = path.join(directory, b);

          let aIsDir = false;
          let bIsDir = false;

          try {
            aIsDir = fs.statSync(aPath).isDirectory();
            bIsDir = fs.statSync(bPath).isDirectory();
          } catch {
            return 0;
          }

          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;
          return a.localeCompare(b);
        });

      for (const file of items) {
        const filePath = path.join(directory, file);
        let stat;

        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          const relativePath = filePath.replace(this.directoryPath, '');
          tree[relativePath] = {
            type: 'directory',
            items: {},
            lines: 0,
            size: 0,
          };

          await this.buildDirectoryTree(filePath, tree[relativePath].items);
        } else if (stat.isFile()) {
          if (!file.endsWith('.js')) {
            continue;
          }

          const { lines, size } = await this.countLinesInFile(filePath);
          const relativePath = filePath.replace(this.directoryPath, '');

          tree[relativePath] = {
            type: 'file',
            lines,
            size,
          };
        }
      }

      return tree;
    } catch (error) {
      console.warn(
        `[STATS] Erreur lors du parcours de ${directory}:`,
        error.message,
      );
      return tree;
    }
  }

  async calculateProjectStats() {
    this.totalLines = 0;
    this.totalSize = 0;
    this.fileStats = [];
    this.treeStructure = {};

    try {
      console.log(
        `[STATS] Calcul des statistiques depuis: ${this.directoryPath}`,
      );

      if (!this.targetExists) {
        console.warn(
          `[STATS] Répertoire cible introuvable: ${this.directoryPath}`,
        );
        return {
          totalLines: 0,
          totalSize: 0,
          sizeMessage: '0 KB',
          fileCount: 0,
          largestFiles: [],
          mostLinesFiles: [],
        };
      }
      await this.buildDirectoryTree(this.directoryPath, this.treeStructure);

      const sizeInKB = (this.totalSize / 1024).toFixed(2);
      const sizeInMB = (this.totalSize / (1024 * 1024)).toFixed(2);
      const sizeInGB = (this.totalSize / (1024 * 1024 * 1024)).toFixed(2);

      let sizeMessage = `${sizeInKB} KB`;
      if (parseFloat(sizeInMB) > 1) sizeMessage += ` (${sizeInMB} MB)`;
      if (parseFloat(sizeInGB) > 1) sizeMessage += ` (${sizeInGB} GB)`;

      console.log(
        `[STATS] Résultats: ${this.totalLines} lignes, ${sizeMessage}, ${this.fileStats.length} fichiers .js`,
      );

      return {
        totalLines: this.totalLines,
        totalSize: this.totalSize,
        sizeMessage: sizeMessage,
        fileCount: this.fileStats.length,
        largestFiles: this.getLargestFiles(5),
        mostLinesFiles: this.getMostLinesFiles(5),
      };
    } catch (error) {
      console.error(
        '[STATS] Erreur lors du calcul des statistiques:',
        error.message,
      );
      return {
        totalLines: 0,
        totalSize: 0,
        sizeMessage: '0 KB',
        fileCount: 0,
        largestFiles: [],
        mostLinesFiles: [],
      };
    }
  }

  getLargestFiles(count = 5) {
    return this.fileStats
      .sort((a, b) => b.size - a.size)
      .slice(0, count)
      .map((file) => ({
        path: file.path.replace(this.directoryPath, ''),
        size: file.size,
        sizeFormatted: `${(file.size / 1024).toFixed(2)} KB`,
        lines: file.lines,
      }));
  }

  getMostLinesFiles(count = 5) {
    return this.fileStats
      .sort((a, b) => b.lines - a.lines)
      .slice(0, count)
      .map((file) => ({
        path: file.path.replace(this.directoryPath, ''),
        lines: file.lines,
        size: file.size,
        sizeFormatted: `${(file.size / 1024).toFixed(2)} KB`,
      }));
  }
}

let calculator = null;
let lastCalculation = null;
let lastCalculationTime = 0;
const CALCULATION_CACHE_DURATION = 60000;

async function getAccurateProjectStats() {
  const now = Date.now();

  if (
    lastCalculation &&
    now - lastCalculationTime < CALCULATION_CACHE_DURATION
  ) {
    return lastCalculation;
  }

  if (!calculator) {
    calculator = new AccurateStatsCalculator();
  }

  const stats = await calculator.calculateProjectStats();
  lastCalculation = stats;
  lastCalculationTime = now;

  console.log(
    `[STATS] Calcul terminé: ${stats.totalLines} lignes, ${stats.sizeMessage}`,
  );

  return stats;
}

export { AccurateStatsCalculator, getAccurateProjectStats };

