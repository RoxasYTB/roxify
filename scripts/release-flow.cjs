#!/usr/bin/env node
const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

function run(cmd, opts = {}) {
  console.log('> ' + cmd);
  return execSync(cmd, { stdio: 'inherit', ...opts });
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
const targetVersion = process.argv[2] || process.env.VERSION || `1.6.1`;
const autoPublish = process.env.AUTO_PUBLISH === '1';

console.log(`Preparing release ${targetVersion}`);

console.log('\n==> Running local tests (npm test)');
run('npm test');

console.log('\n==> Creating git tag and committing version bump');
run(`npm version ${targetVersion} -m "chore(release): %s"`);

run('git push origin --follow-tags');

console.log(
  '\n==> Waiting for remote build workflow to finish (Build Native Binaries)',
);
let ghAvailable = true;
try {
  runSilent('gh --version');
} catch (e) {
  ghAvailable = false;
}

if (!ghAvailable) {
  console.log(
    'gh CLI not found. Please monitor GitHub Actions manually for tag ' +
      `v${targetVersion}`,
  );
  console.log('When builds pass, run: npm run release:github');
  process.exit(0);
}

const tagSha = runSilent(`git rev-parse v${targetVersion}`);
if (!tagSha) {
  console.error('Failed to find tag SHA. Aborting.');
  process.exit(1);
}

const workflowName = 'Build Native Binaries';
let attempt = 0;
let maxAttempts = 60;
let runId = null;
let conclusion = null;

while (attempt < maxAttempts) {
  attempt++;
  console.log(`Checking workflow runs (attempt ${attempt}/${maxAttempts})...`);
  try {
    const listOutput = runSilent(
      `gh run list --workflow "${workflowName}" --json database --limit 50`,
    );
    const runs = JSON.parse(listOutput || '[]');
    for (const r of runs) {
      if (r.headSha === tagSha) {
        runId = r.id;
        conclusion = r.conclusion || null;
        break;
      }
    }
    if (!runId) {
      const runs2 = JSON.parse(
        runSilent(
          `gh run list --workflow "${workflowName}" --json id,headSha,conclusion,createdAt --limit 200`,
        ) || '[]',
      );
      for (const r of runs2) {
        if (r.headSha === tagSha) {
          runId = r.id;
          conclusion = r.conclusion || null;
          break;
        }
      }
    }

    if (runId) {
      console.log(`Found workflow run id ${runId}, conclusion=${conclusion}`);
      if (conclusion === 'success') break;
      if (
        conclusion === 'failure' ||
        conclusion === 'cancelled' ||
        conclusion === 'timed_out'
      ) {
        console.error('Build workflow failed. Aborting release.');
        run(`gh run view ${runId} --log`);
        process.exit(1);
      }
    }
  } catch (e) {
    console.warn('Error while querying gh run list:', e.message || e);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
}

if (!runId) {
  console.log(
    'No workflow run found for the tag yet. Please check GitHub Actions.',
  );
  process.exit(1);
}

console.log('Build workflow succeeded. Proceeding to create GitHub release...');

run('npm run release:github');

console.log('\n==> Preparing npm package');
run('npm run package:prepare');

if (autoPublish) {
  if (!process.env.NPM_TOKEN) {
    console.error('NPM_TOKEN not set. Cannot publish. Aborting.');
    process.exit(1);
  }
  console.log('\n==> Publishing to npm');
  run('npm config set //registry.npmjs.org/:_authToken=${NPM_TOKEN}');
  run('npm publish --access public');
}

console.log('\nRelease flow complete.');
process.exit(0);
