#!/usr/bin/env node

import { rmSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

try {
  rmSync(join(root, 'target'), { recursive: true, force: true });
} catch (e) {}

try {
  rmSync(join(root, 'artifacts'), { recursive: true, force: true });
} catch (e) {}

console.log('✓ Cleaned target/ and temporary platform artifacts');
