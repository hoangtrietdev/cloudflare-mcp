import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import { CloudflareClient } from '../services/cloudflare.js';
import { authenticateAccessToken } from './oauth.js';
import type { CloudflareCredentials } from './oauth-store.js';

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20_000;
const projectName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const cleanDomain = z.string().min(3).max(253).regex(/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i);

function registerTools(server: McpServer, credentials: CloudflareCredentials) {
  const client = new CloudflareClient(credentials.apiToken, credentials.accountId);
  server.registerTool('deploy_to_cloudflare_pages', {
    title: 'Deploy to Cloudflare Pages',
    description: 'Deploy prebuilt static assets from a public GitHub repository to Cloudflare Pages. Does not run repository scripts or build code.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: { project_name: projectName, repo_url: z.string().url(), branch: z.string().min(1).max(100).default('main'), output_dir: z.string().default('.'), spa_mode: z.boolean().default(false) }
  }, async ({ project_name, repo_url, branch, output_dir, spa_mode }) => {
    let directory: string | undefined;
    try {
      directory = await downloadBuild(repo_url, branch, output_dir);
      const result = await client.deploy(project_name, directory, branch, { spaMode: spa_mode });
      return { content: [{ type: 'text', text: `Deployment ${result.status}\nURL: ${result.url}\nDeployment ID: ${result.id}\nTimestamp: ${result.timestamp}` }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: safeError(error) }] }; }
    finally { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
  });
  server.registerTool('attach_custom_domain', {
    title: 'Attach a custom domain',
    description: 'Bind a custom domain to a Cloudflare Pages project, and create a CNAME if its DNS zone is in this Cloudflare account and there is no conflicting record.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: { project_name: projectName, domain: cleanDomain }
  }, async ({ project_name, domain }) => {
    try {
      const result = await client.attachDomain(project_name, domain);
      return { content: [{ type: 'text', text: `## Custom domain\n\n- URL: ${result.projectUrl}\n- Pages: ${result.domainStatus}\n- SSL: ${result.sslStatus}\n- DNS: ${result.dnsAction}` }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: safeError(error) }] }; }
  });
  server.registerTool('list_deployments', {
    title: 'List Pages deployments',
    description: 'List recent deployment status, live URLs, and custom domains for a Cloudflare Pages project.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: { project_name: projectName }
  }, async ({ project_name }) => {
    try {
      const result = await client.listProject(project_name);
      const deployments = result.deployments.length ? result.deployments.map(item => `- ${item.created_on ?? 'Unknown time'} · ${item.latest_stage?.status ?? 'unknown'} · ${item.url ?? item.id}`).join('\n') : '- No deployments found.';
      const domains = result.domains.length ? result.domains.map(item => `- ${item.name}: ${item.status ?? 'unknown'}`).join('\n') : '- No custom domains configured.';
      return { content: [{ type: 'text', text: `## ${project_name}\n\n### Recent deployments\n${deployments}\n\n### Custom domains\n${domains}` }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: safeError(error) }] }; }
  });
}

const handler = withMcpAuth(async request => {
  const credentials = request.auth?.extra as CloudflareCredentials | undefined;
  if (!credentials) return Response.json({ error: 'Invalid authorization token.' }, { status: 401 });
  return createMcpHandler(server => registerTools(server, credentials), { serverInfo: { name: 'mcp-cloud-deploy', version: '1.2.0' } })(request);
}, async (_request, bearer) => {
  if (!bearer) return undefined;
  const authenticated = await authenticateAccessToken(bearer);
  if (!authenticated) return undefined;
  return { token: bearer, clientId: authenticated.grant.clientId, scopes: authenticated.grant.scope.split(' '), expiresAt: Math.floor(Date.now()/1000) + 3600, extra: authenticated.credentials };
}, { required: true, requiredScopes: ['mcp:write'], resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp' });

export { handler as GET, handler as POST, handler as DELETE };

function safeError(error: unknown) {
  if (!(error instanceof Error)) return 'Unexpected deployment error. Check the repository and Cloudflare permissions, then retry.';
  return error.message.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]').slice(0, 1200);
}

async function downloadBuild(repoUrl: string, branch: string, outputDir: string): Promise<string> {
  let url: URL;
  try { url = new URL(repoUrl); } catch { throw new Error('repo_url must be a public GitHub repository URL.'); }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || parts.length < 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) throw new Error('Online deploy supports public GitHub repositories only. Private or arbitrary URLs are not fetched.');
  const owner = parts[0]; const repo = parts[1].replace(/\.git$/i, '');
  const folder = parts[2] === 'tree' ? parts.slice(4).join('/') : '';
  if (outputDir.startsWith('/') || outputDir.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('output_dir must stay inside the GitHub repository (use "." for its root).');
  const selectedDir = [folder, outputDir === '.' ? '' : outputDir].filter(Boolean).join('/').replace(/^\/+|\/+$/g, '');
  let archive = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch)}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mcp-cloud-deploy' }, signal: AbortSignal.timeout(30_000), redirect: 'manual' });
  if (archive.status >= 300 && archive.status < 400) {
    const location = archive.headers.get('location');
    if (!location || new URL(location).hostname !== 'codeload.github.com' || new URL(location).protocol !== 'https:') throw new Error('GitHub returned an unexpected archive redirect; refusing to fetch it.');
    archive = await fetch(location, { headers: { 'User-Agent': 'mcp-cloud-deploy' }, signal: AbortSignal.timeout(30_000), redirect: 'manual' });
  }
  if (!archive.ok) throw new Error(`GitHub could not provide this public repository archive (HTTP ${archive.status}). Check its visibility and branch.`);
  if (!archive.body) throw new Error('GitHub returned an empty repository archive.');
  const reader = archive.body.getReader(); const archiveChunks: Uint8Array[] = []; let compressedSize = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    compressedSize += value.byteLength;
    if (compressedSize > MAX_ARCHIVE_BYTES) { await reader.cancel(); throw new Error('GitHub archive exceeds the 20 MiB online limit. Use local stdio mode for larger builds.'); }
    archiveChunks.push(value);
  }
  const compressed = new Uint8Array(compressedSize); let zipOffset = 0;
  for (const chunk of archiveChunks) { compressed.set(chunk, zipOffset); zipOffset += chunk.byteLength; }
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cloud-deploy-'));
  const zip = compressed; const pending: Promise<void>[] = []; let root = ''; let expanded = 0; let count = 0; let problem: Error | undefined;
  const unzip = new Unzip(file => {
    if (problem || file.name.endsWith('/')) return;
    count += 1;
    const pieces = file.name.split('/');
    if (file.name.startsWith('/') || pieces.some(piece => piece === '..' || piece === '.')) { problem = new Error('The GitHub archive contains an unsafe path.'); return; }
    if (!root) root = `${pieces[0]}/`;
    if (!file.name.startsWith(root)) return;
    const relative = file.name.slice(root.length);
    const prefix = selectedDir ? `${selectedDir}/` : '';
    if (!relative.startsWith(prefix)) return;
    const asset = relative.slice(prefix.length);
    if (!asset || /(^|\/)\.(?:env|git|github)(?:\/|$)/i.test(asset)) return;
    if (count > MAX_FILES + 10_000) { problem = new Error('This archive contains too many files.'); return; }
    if (file.originalSize === undefined || file.originalSize > MAX_FILE_BYTES) { problem = new Error(`Build asset exceeds the 10 MiB online per-file limit: ${asset}`); return; }
    expanded += file.originalSize;
    if (expanded > MAX_TOTAL_BYTES) { problem = new Error('Build output exceeds the 50 MiB online expanded-size limit.'); return; }
    const target = path.resolve(directory, asset);
    if (!target.startsWith(`${directory}${path.sep}`)) { problem = new Error('The GitHub archive contains an unsafe path.'); return; }
    const chunks: Uint8Array[] = []; let size = 0;
    pending.push(new Promise<void>((resolve, reject) => {
      file.ondata = (err, chunk, final) => {
        if (err) { reject(err); return; }
        size += chunk.byteLength; if (size > MAX_FILE_BYTES) { reject(new Error(`Build asset exceeds the per-file limit: ${asset}`)); return; }
        chunks.push(chunk);
        if (final) {
          const bytes = new Uint8Array(size); let offset = 0;
          for (const item of chunks) { bytes.set(item, offset); offset += item.byteLength; }
          const write = mkdir(path.dirname(target), { recursive: true }).then(() => writeFile(target, bytes));
          write.then(() => resolve(), reject);
        }
      };
      file.start();
    }));
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(zip, true);
    await Promise.all(pending);
    if (problem) throw problem;
    const index = await import('node:fs/promises').then(fs => fs.stat(path.join(directory, 'index.html')).catch(() => null));
    if (!index?.isFile()) throw new Error(`No index.html found in GitHub output folder "${selectedDir || '/'}". Commit your built static output first.`);
    return directory;
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error instanceof Error ? error : new Error('Could not extract the GitHub build archive.'); }
}
