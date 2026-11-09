#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entrypoint = join(projectRoot, 'dist', 'index.js');

try {
  await access(entrypoint, constants.R_OK);
} catch {
  console.error('mcp-cloud-deploy is not built yet. Run `npm ci && npm run build` in the repository first.');
  process.exit(1);
}

process.chdir(projectRoot);
await import(pathToFileURL(entrypoint).href);
