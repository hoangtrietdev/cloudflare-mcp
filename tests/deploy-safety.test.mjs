import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CloudflareClient } from '../dist/services/cloudflare.js';

test('refuses to upload dotenv credentials from a selected build directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cloud-deploy-secret-test-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<h1>hello</h1>');
    await writeFile(path.join(directory, '.env'), 'CLOUDFLARE_API_TOKEN=must-not-upload');
    const client = new CloudflareClient('test-token', '00000000000000000000000000000000');
    await assert.rejects(client.deploy('test-project', directory, 'main'), /Refusing to deploy a file that may contain credentials: \.env/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('skips local dependency and Vercel metadata directories', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cloud-deploy-ignore-test-'));
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    return Response.json({ success: false, errors: [{ code: 10000, message: 'test stop after validation' }] }, { status: 401 });
  };
  try {
    await writeFile(path.join(directory, 'index.html'), '<h1>hello</h1>');
    await mkdir(path.join(directory, 'node_modules'), { recursive: true });
    await writeFile(path.join(directory, 'node_modules', 'secret.pem'), 'not copied');
    await mkdir(path.join(directory, '.vercel'), { recursive: true });
    await writeFile(path.join(directory, '.vercel', 'project.json'), '{}');
    const client = new CloudflareClient('test-token', '00000000000000000000000000000000');
    await assert.rejects(client.deploy('test-project', directory, 'main'), /Authentication failed/);
    assert.ok(paths.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
