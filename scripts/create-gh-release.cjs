#!/usr/bin/env node
const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

function run(cmd) {
  console.log('> ' + cmd);
  return execSync(cmd, { stdio: 'inherit' });
}

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
);
const tag = process.env.TAG || `v${pkg.version}`;
const title = process.env.TITLE || `${tag}`;
const notes = process.env.NOTES || '';

try {
  run(`git rev-parse --verify ${tag}`);
  console.log(`Tag ${tag} exists locally`);
} catch (e) {
  console.log(`Tag ${tag} not found, creating...`);
  run(`git tag ${tag}`);
  run(`git push origin ${tag}`);
}

try {
  run('gh --version');
} catch (e) {
  console.error(
    'gh CLI not found in PATH. Install GitHub CLI to upload releases.',
  );
  process.exit(1);
}

let releaseCmd = `gh release create ${tag} release/* --title "${title}"`;
if (notes) releaseCmd += ` --notes "${notes}"`;
run(releaseCmd);

console.log(`\nGitHub release ${tag} created and artifacts uploaded.`);
