#!/usr/bin/env node
const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

function run(cmd, opts = {}) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
);
const argVersion = process.argv[2];
const version = argVersion || process.env.VERSION || pkg.version;

if (!version) {
  console.error('Version not specified (arg or package.json). Aborting.');
  process.exit(1);
}

if (argVersion && argVersion !== pkg.version) {
  console.log(`Bumping version ${pkg.version} -> ${argVersion}`);
  run(`npm version ${argVersion} -m "chore(release): %s"`);
  run('git push origin --follow-tags');
}

const npmWhoami = runSilent('npm whoami');
if (!process.env.NPM_TOKEN && !npmWhoami) {
  console.error(
    'Not authenticated with npm (NPM_TOKEN missing and npm whoami empty). Aborting publish.',
  );
  process.exit(1);
}

console.log('\n==> Running integration tests (test:integration)');
run('npm run test:integration');

console.log('\n==> Preparing and creating GitHub release (release:github)');
run('npm run release:github');

console.log('\n==> Preparing npm package');
run('npm run package:prepare');

console.log('\n==> Publishing to npm registry');
if (process.env.NPM_TOKEN) {
  run(
    `npm config set //registry.npmjs.org/:_authToken="${process.env.NPM_TOKEN}"`,
  );
} else {
  console.log('Using existing npm login session');
}
run('npm publish --access public');

console.log('\nPublish complete.');
process.exit(0);
