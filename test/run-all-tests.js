#!/usr/bin/env node
import { execSync } from 'child_process';

const tests = [
  'test/test-simple-screenshot.js',
  'test/test-final-complete.js',
  'test/test-empty-dir.js',
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${test}`);
    console.log('='.repeat(60));
    execSync(`node ${test}`, { stdio: 'inherit' });
    passed++;
  } catch (err) {
    console.error(`\n✗ FAILED: ${test}`);
    failed++;
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Test Summary: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
