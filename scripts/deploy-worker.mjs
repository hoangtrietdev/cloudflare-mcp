import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const kvId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
if (!token || !accountId || !/^[a-f0-9]{32}$/i.test(accountId) || !/^[a-f0-9]{32}$/i.test(kvId ?? '')) {
  throw new Error('Set CLOUDFLARE_API_TOKEN, a 32-character CLOUDFLARE_ACCOUNT_ID, and a 32-character CLOUDFLARE_KV_NAMESPACE_ID.');
}
const configPath = path.join(root, 'remote/wrangler.jsonc');
const generatedPath = path.join(root, 'remote/.wrangler.deploy.jsonc');
const config = JSON.parse(await readFile(configPath, 'utf8'));
config.kv_namespaces = config.kv_namespaces.map(binding => binding.binding === 'OAUTH_KV' ? { ...binding, id: kvId } : binding);
await writeFile(generatedPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
try {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, ['wrangler', 'deploy', '--config', 'remote/.wrangler.deploy.jsonc'], { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  if (result !== 0) process.exitCode = Number(result);
} finally {
  await rm(generatedPath, { force: true });
}
