import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCloudflareApiToken } from '../dist/hosted/cloudflare-auth.js';
import { safeRedirect, validateCredentials } from '../dist/hosted/oauth.js';
import { seal, unseal } from '../dist/hosted/oauth-store.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.MCP_CREDENTIALS_ENCRYPTION_KEY;
const accountId = '0123456789abcdef0123456789abcdef';

test('verifies account-owned Cloudflare tokens using the account token endpoint', async () => {
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({ success: true, result: { status: 'active' } });
  };
  try {
    await verifyCloudflareApiToken(accountId, 'cfat_test-account-token');
    assert.equal(calls[0], `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`);
  } finally { globalThis.fetch = originalFetch; }
});

test('verifies user-owned Cloudflare tokens using the user token endpoint', async () => {
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({ success: true, result: { status: 'active' } });
  };
  try {
    await verifyCloudflareApiToken(accountId, 'user-owned-test-token-1234567890');
    assert.equal(calls[0], 'https://api.cloudflare.com/client/v4/user/tokens/verify');
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects inactive Cloudflare tokens without disclosing the token', async () => {
  globalThis.fetch = async () => Response.json({ success: true, result: { status: 'expired' } });
  try {
    await assert.rejects(verifyCloudflareApiToken(accountId, 'cfat_expired-test-token-123456'), /active API token/);
  } finally { globalThis.fetch = originalFetch; }
});

test('validates an account token and the requested Pages account', async () => {
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (String(input).endsWith('/tokens/verify')) return Response.json({ success: true, result: { status: 'active' } });
    return Response.json({ success: true, result: { name: 'pages-permission-probe', subdomain: 'example.pages.dev' } });
  };
  try {
    await validateCredentials(accountId, 'cfat_test-account-token');
    assert.match(calls[0], new RegExp(`/accounts/${accountId}/tokens/verify$`));
    assert.match(calls[1], new RegExp(`/accounts/${accountId}/pages/projects/`));
  } finally { globalThis.fetch = originalFetch; }
});

test('accepts HTTPS and loopback OAuth redirects but rejects unsafe URL forms', () => {
  for (const uri of ['https://client.example/callback', 'http://127.0.0.1:3456/callback', 'http://[::1]:3456/callback']) assert.equal(safeRedirect(uri), true, uri);
  for (const uri of ['http://client.example/callback', 'https://user:pass@client.example/callback', 'https://client.example/callback#fragment', 'javascript:alert(1)', 'not a URL']) assert.equal(safeRedirect(uri), false, uri);
});

test('encrypts and decrypts credentials using AES-256-GCM', async () => {
  process.env.MCP_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    const plaintext = JSON.stringify({ accountId, apiToken: 'credential-that-must-remain-secret' });
    const ciphertext = await seal(plaintext);
    assert.notEqual(ciphertext, plaintext);
    assert.equal(await unseal(ciphertext), plaintext);
    const [iv, tag, data] = ciphertext.split('.');
    const tampered = `${iv}.${tag}.${Buffer.from(data, 'base64url').map((byte, index) => index === 0 ? byte ^ 1 : byte).toString('base64url')}`;
    await assert.rejects(unseal(tampered));
  } finally {
    if (originalKey === undefined) delete process.env.MCP_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.MCP_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});
