#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';
import { domainSchema, projectNameSchema } from './validation.js';
import { CloudflareClient } from './services/cloudflare.js';

const server = new McpServer({ name: 'mcp-cloud-deploy', version: '1.0.0' });
const errorText = (error: unknown): string => error instanceof Error ? error.message : 'Unexpected error.';

server.tool('deploy_to_cloudflare_pages', 'Deploy a static website to Cloudflare Pages. Supports landing pages with nested image/assets and React/Vite single-page apps. If domain is omitted, the deployment URL works without owning a domain; if provided, bind it and configure Cloudflare DNS when possible.', {
  project_name: projectNameSchema.describe('Cloudflare Pages project name.'),
  dir_path: z.string().min(1).describe('Absolute or relative path to the built static directory, which must contain index.html.'),
  branch: z.string().min(1).max(100).default('main').describe('Deployment branch; defaults to main.'),
  spa_mode: z.boolean().default(false).describe('Enable for React/Vite apps using client-side history routes. Adds a Cloudflare Pages fallback to index.html. Leave false for traditional multi-page static sites.'),
  domain: domainSchema.optional().describe('Optional custom domain to bind after deployment, for example www.example.com. Omit if you do not own a domain; the pages.dev URL is ready to use.')
}, { title: 'Deploy to Cloudflare Pages', readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ project_name, dir_path, branch, spa_mode, domain }) => {
  try {
    const client = new CloudflareClient();
    const result = await client.deploy(project_name, dir_path, branch, { spaMode: spa_mode });
    let domainSummary = '\nNo custom domain supplied; use the pages.dev deployment URL above. You can attach one later with attach_custom_domain.';
    if (domain) {
      try {
        const attached = await client.attachDomain(project_name, domain);
        domainSummary = `\n\n## Custom domain\n- URL: ${attached.projectUrl}\n- Pages status: ${attached.domainStatus}\n- SSL status: ${attached.sslStatus}\n- DNS: ${attached.dnsAction}`;
      } catch (error) {
        domainSummary = `\n\nThe site deployment succeeded at ${result.url}, but custom domain setup did not complete: ${errorText(error)}`;
      }
    }
    return { content: [{ type: 'text', text: `Deployment ${result.status}\nURL: ${result.url}\nDeployment ID: ${result.id}\nTimestamp: ${result.timestamp}${domainSummary}` }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: errorText(error) }] }; }
});

server.tool('attach_custom_domain', 'Bind a custom domain to a Cloudflare Pages project and create a CNAME in a matching Cloudflare DNS zone when available.', {
  project_name: projectNameSchema.describe('Target Cloudflare Pages project name.'),
  domain: domainSchema.describe('Fully qualified custom domain, for example app.example.com.')
}, { title: 'Attach a custom domain', readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ project_name, domain }) => {
  try {
    const result = await new CloudflareClient().attachDomain(project_name, domain);
    return { content: [{ type: 'text', text: `## Custom domain\n\n- Domain: ${domain}\n- Pages project: ${result.projectUrl}\n- Pages status: ${result.domainStatus}\n- SSL status: ${result.sslStatus}\n- DNS: ${result.dnsAction}${result.zone ? `\n- Cloudflare zone: ${result.zone}` : ''}` }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: errorText(error) }] }; }
});

server.tool('list_deployments', 'List recent Cloudflare Pages deployments, live URLs, and custom domain bindings. Cloudflare Pages deployments support nested static assets and React/Vite builds.', {
  project_name: projectNameSchema.describe('Cloudflare Pages project name.')
}, { title: 'List Pages deployments', readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async ({ project_name }) => {
  try {
    const result = await new CloudflareClient().listProject(project_name);
    const deployments = result.deployments.length ? result.deployments.map(item => `- ${item.created_on ?? 'Time unknown'} — ${item.latest_stage?.status ?? 'status unknown'} — ${item.url ? `https://${item.url.replace(/^https?:\/\//, '')}` : item.id} (${item.environment ?? 'environment unknown'})`).join('\n') : '- No deployments found.';
    const domains = result.domains.length ? result.domains.map(item => `- ${item.name}: ${item.status ?? 'status unknown'}`).join('\n') : '- No custom domains configured.';
    return { content: [{ type: 'text', text: `## ${project_name}\n\n### Recent deployments\n${deployments}\n\n### Custom domains\n${domains}` }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: errorText(error) }] }; }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('mcp-cloud-deploy MCP server running on stdio');
}

main().catch(error => { console.error(`mcp-cloud-deploy failed to start: ${errorText(error)}`); process.exitCode = 1; });
