import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('starts over stdio and exposes the three deployment tools', async () => {
  const client = new Client({ name: 'mcp-cloud-deploy-smoke-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['scripts/start-local.mjs'],
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: 'smoke-test-token',
      CLOUDFLARE_ACCOUNT_ID: '00000000000000000000000000000000',
    },
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'attach_custom_domain',
      'deploy_to_cloudflare_pages',
      'list_deployments',
    ]);
    const deploy = tools.find((tool) => tool.name === 'deploy_to_cloudflare_pages');
    assert.ok(deploy.inputSchema.properties.spa_mode);
    assert.ok(deploy.inputSchema.properties.domain);
  } finally {
    await client.close();
  }
});
