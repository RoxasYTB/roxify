import { execSync } from 'child_process';
import fs from 'fs';

const MAX_ITERATIONS = 10;
const reportPath = './eslint-report.json';

function runEslint() {
  if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);

  console.log('Analyse ESLint en cours...');

  let eslintOutput = '';

  try {
    eslintOutput = execSync('npx eslint . -f json', {
      encoding: 'utf8',
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });
    fs.writeFileSync(reportPath, eslintOutput, 'utf8');
    console.log('Analyse ESLint terminée (sans erreurs détectées).');
  } catch (err) {
    if (err.stdout) {
      eslintOutput = err.stdout;
      fs.writeFileSync(reportPath, eslintOutput, 'utf8');
      console.log('Analyse ESLint terminée (erreurs détectées).');
    } else {
      const eslintError = err.stderr || err.message || 'Erreur inconnue';
      console.error('❌ Erreur ESLint:', eslintError);
      return null;
    }
  }

  if (!fs.existsSync(reportPath)) {
    console.error('❌ Aucun rapport ESLint trouvé.');
    return null;
  }

  const reportContent = fs.readFileSync(reportPath, 'utf8');
  console.log(`📄 Taille du rapport: ${reportContent.length} caractères`);

  if (!reportContent.trim()) {
    console.error('❌ Le rapport ESLint est vide.');
    return null;
  }

  try {
    const report = JSON.parse(reportContent);
    console.log(`📋 ${report.length} fichier(s) analysé(s)`);
    return report;
  } catch (parseErr) {
    console.error('❌ Erreur de parsing JSON:', parseErr.message);
    console.error(
      'Contenu du rapport (100 premiers caractères):',
      reportContent.substring(0, 100),
    );
    return null;
  }
}

function findMultiLineEnd(code, startIndex) {
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = startIndex; i < code.length; i++) {
    const line = code[i];
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const prevChar = j > 0 ? line[j - 1] : '';

      if (inString) {
        if (char === stringChar && prevChar !== '\\') {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        stringChar = char;
        continue;
      }

      if (char === '{' || char === '[' || char === '(') depth++;
      if (char === '}' || char === ']' || char === ')') depth--;
    }

    if (depth <= 0 && (line.includes(';') || line.trim().endsWith(','))) {
      return i;
    }
    if (depth <= 0 && i > startIndex) {
      return i;
    }
  }
  return startIndex;
}

function isVariableUsedLater(code, varName, startLine) {
  const varRegex = new RegExp(`\\b${varName}\\b`);
  for (let i = startLine + 1; i < code.length; i++) {
    const line = code[i];
    if (line.includes('//')) {
      const withoutComment = line.split('//')[0];
      if (varRegex.test(withoutComment)) return true;
    } else if (varRegex.test(line)) {
      return true;
    }
  }
  return false;
}

function processReport(report) {
  let totalChanges = 0;

  for (const file of report) {
    if (!file.messages.length) continue;

    const unusedVarMessages = file.messages.filter(
      (msg) =>
        msg.ruleId === 'no-unused-vars' ||
        msg.ruleId === 'unused-imports/no-unused-vars',
    );

    if (!unusedVarMessages.length) continue;

    let code = fs.readFileSync(file.filePath, 'utf8').split('\n');
    let changed = false;
    const processedLines = new Set();

    const sortedMessages = [...unusedVarMessages].sort(
      (a, b) => b.line - a.line,
    );

    for (const msg of sortedMessages) {
      const lineIndex = msg.line - 1;
      if (processedLines.has(lineIndex)) continue;

      const varNameMatch = msg.message.match(/'(.+?)'/);
      const varName = varNameMatch ? varNameMatch[1] : null;
      if (!varName) continue;

      if (varName.startsWith('_')) {
        continue;
      }

      let line = code[lineIndex];
      if (/\bcatch\s*\(\s*\w+\s*\)/.test(line)) {
        code[lineIndex] = line.replace(/\bcatch\s*\(\s*\w+\s*\)/, 'catch');
        changed = true;
        processedLines.add(lineIndex);
        console.log(
          `[CLEAN] Argument catch supprimé (${file.filePath}:${msg.line}).`,
        );
        continue;
      }

      const destructParamMatch = line.match(/\{\s*([^}]+)\s*\}/);
      if (destructParamMatch && new RegExp(`\\b${varName}\\b`).test(line)) {
        const newLine = line.replace(
          new RegExp(`\\b${varName}\\b(?!\\s*:)`),
          `${varName}: _${varName}`,
        );
        if (newLine !== line && newLine !== line) {
          code[lineIndex] = newLine;
          changed = true;
          processedLines.add(lineIndex);
          console.log(
            `[CLEAN] Paramètre déstructuré '${varName}' renommé (${file.filePath}:${msg.line}).`,
          );
          continue;
        }
      }

      const funcParamMatch = line.match(
        /(?:function\s+\w+|(?:async\s+)?(?:\w+|\([^)]*\))\s*=>|\w+\s*\([^)]*\)\s*\{)/,
      );
      const arrowOrFuncLine =
        /(?:=>|function\s*\(|async\s+function|\)\s*\{)/.test(line);
      const isCallback = /\.\w+\(\s*(?:async\s*)?\(?[^)]*\)?\s*=>/.test(line);

      if (
        (funcParamMatch || arrowOrFuncLine || isCallback) &&
        new RegExp(`[\\(,]\\s*${varName}\\s*[,\\)]`).test(line)
      ) {
        const newLine = line.replace(
          new RegExp(`([\\(,]\\s*)${varName}(\\s*[,\\)])`),
          `$1_${varName}$2`,
        );
        if (newLine !== line) {
          code[lineIndex] = newLine;
          changed = true;
          processedLines.add(lineIndex);
          console.log(
            `[CLEAN] Paramètre '${varName}' préfixé (${file.filePath}:${msg.line}).`,
          );
          continue;
        }
      }

      if (/\bimport\b/.test(line)) {
        if (new RegExp(`^\\s*import\\s+${varName}\\s+from\\s+`).test(line)) {
          const endLine = findMultiLineEnd(code, lineIndex);
          for (let i = lineIndex; i <= endLine; i++) {
            code[i] = '';
            processedLines.add(i);
          }
          changed = true;
          console.log(
            `[CLEAN] Import par défaut supprimé (${file.filePath}:${msg.line}).`,
          );
          continue;
        }

        if (
          new RegExp(`^\\s*import\\s+\\*\\s+as\\s+${varName}\\s+from`).test(
            line,
          )
        ) {
          code[lineIndex] = '';
          processedLines.add(lineIndex);
          changed = true;
          console.log(
            `[CLEAN] Import namespace supprimé (${file.filePath}:${msg.line}).`,
          );
          continue;
        }

        if (/\bimport\s*\{/.test(line)) {
          let importEndLine = lineIndex;
          let importContent = line;
          while (
            !importContent.includes('from') &&
            importEndLine < code.length - 1
          ) {
            importEndLine++;
            importContent += '\n' + code[importEndLine];
          }

          const fullImport = code
            .slice(lineIndex, importEndLine + 1)
            .join('\n');

          if (new RegExp(`\\b${varName}\\b`).test(fullImport)) {
            const namedImportsMatch = fullImport.match(/\{([^}]+)\}/);
            if (namedImportsMatch) {
              const imports = namedImportsMatch[1]
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);

              if (imports.length === 1) {
                for (let i = lineIndex; i <= importEndLine; i++) {
                  code[i] = '';
                  processedLines.add(i);
                }
                changed = true;
                console.log(
                  `[CLEAN] Import unique supprimé (${file.filePath}:${msg.line}).`,
                );
              } else {
                const newImport = fullImport
                  .replace(new RegExp(`\\b${varName}\\b\\s*,\\s*`), '')
                  .replace(new RegExp(`\\s*,\\s*\\b${varName}\\b`), '')
                  .replace(new RegExp(`\\b${varName}\\b`), '')
                  .replace(/,(\s*[,\}])/g, '$1')
                  .replace(/\{\s*,/g, '{')
                  .replace(/,\s*\}/g, '}');

                const cleanImport = newImport.replace(/\s+/g, ' ').trim();
                code[lineIndex] = cleanImport;
                for (let i = lineIndex + 1; i <= importEndLine; i++) {
                  code[i] = '';
                  processedLines.add(i);
                }
                processedLines.add(lineIndex);
                changed = true;
                console.log(
                  `[CLEAN] Import nommé '${varName}' supprimé (${file.filePath}:${msg.line}).`,
                );
              }
            }
          }
          continue;
        }

        if (/^\s*import\s+.+\s+from\s+/.test(line)) {
          code[lineIndex] = '';
          processedLines.add(lineIndex);
          changed = true;
          console.log(
            `[CLEAN] Import supprimé (${file.filePath}:${msg.line}).`,
          );
          continue;
        }
      }

      const varDeclRegex = new RegExp(`\\b(const|let|var)\\s+${varName}\\b`);

      if (varDeclRegex.test(line)) {
        if (isVariableUsedLater(code, varName, lineIndex)) {
          console.log(
            `[SKIP] Variable '${varName}' utilisée plus tard (${file.filePath}:${msg.line}).`,
          );
          continue;
        }

        const hasOpenBracket =
          (line.match(/[\{\[\(`]/g) || []).length >
          (line.match(/[\}\]\)`]/g) || []).length;
        const endsWithOperator = /[=+\-*\/&|,]\s*$/.test(line.trim());
        const isMultiLine = hasOpenBracket || endsWithOperator;

        if (isMultiLine) {
          const endLine = findMultiLineEnd(code, lineIndex);
          for (let i = lineIndex; i <= endLine; i++) {
            code[i] = '';
            processedLines.add(i);
          }
          changed = true;
          console.log(
            `[CLEAN] Variable multi-lignes '${varName}' supprimée (${file.filePath}:${msg.line}-${endLine + 1}).`,
          );
        } else {
          const multiVarRegex = new RegExp(
            `\\b(const|let|var)\\s+.*,.*${varName}|${varName}.*,`,
          );

          if (multiVarRegex.test(line)) {
            const singleVarRegex = new RegExp(
              `\\b${varName}\\s*=[^,;]*(,|;|$)`,
            );
            code[lineIndex] = line.replace(singleVarRegex, (match, ending) => {
              return ending === ';' ? ';' : '';
            });

            code[lineIndex] = code[lineIndex]
              .replace(/,\s*,/g, ',')
              .replace(/,\s*;/g, ';')
              .replace(/(const|let|var)\s*;/g, '');
            if (code[lineIndex].trim() === '') code[lineIndex] = '';
          } else {
            code[lineIndex] = '';
          }
          processedLines.add(lineIndex);
          changed = true;
          console.log(
            `[CLEAN] Variable '${varName}' supprimée (${file.filePath}:${msg.line}).`,
          );
        }
        continue;
      }
    }

    if (changed) {
      code = code.filter((line, i, arr) => {
        if (line.trim() !== '') return true;
        return i > 0 && arr[i - 1].trim() !== '';
      });

      fs.writeFileSync(file.filePath, code.join('\n'), 'utf8');
      console.log(`[CLEAN] Fichier mis à jour : ${file.filePath}`);
      totalChanges++;
    }
  }

  return totalChanges;
}

let iteration = 0;
let lastChanges = -1;

while (iteration < MAX_ITERATIONS) {
  iteration++;
  console.log(`\n🔄 Itération ${iteration}/${MAX_ITERATIONS}`);

  const report = runEslint();
  if (!report) {
    console.error('❌ Impossible de continuer sans rapport ESLint.');
    break;
  }

  const totalErrors = report.reduce(
    (sum, file) =>
      sum +
      file.messages.filter(
        (m) =>
          m.ruleId === 'no-unused-vars' ||
          m.ruleId === 'unused-imports/no-unused-vars',
      ).length,
    0,
  );

  console.log(`📊 ${totalErrors} erreur(s) no-unused-vars détectée(s)`);

  if (totalErrors === 0) {
    console.log('✅ Aucune erreur restante. Nettoyage terminé !');
    break;
  }

  const changes = processReport(report);

  if (changes === 0) {
    if (lastChanges === 0) {
      console.log(
        `⚠️ Aucun changement possible. ${totalErrors} erreur(s) restante(s) non traitables automatiquement.`,
      );
      break;
    }
    console.log('⏸️ Aucun changement cette itération, nouvelle tentative...');
  }

  lastChanges = changes;
}

if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
console.log('\n✅ Nettoyage terminé.');

