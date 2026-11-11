import { hash as blake3Hash } from 'blake3-wasm';
import { createMcpHandler } from 'agents/mcp/server';
import { OAuthProvider, AuthorizationError, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/server';
import { Unzip, UnzipInflate } from 'fflate';
import { z } from 'zod/v4';

type AuthProps = { accountId: string; apiToken: string };
type Env = { OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers };
type ApiEnvelope<T> = { success: boolean; result: T; errors?: Array<{ message?: string }> };
type Project = { name: string; subdomain?: string; production_branch?: string };
type Deployment = { id: string; url?: string; environment?: string; latest_stage?: { status?: string }; created_on?: string };
type DomainBinding = { name: string; status?: string; verification_data?: { status?: string } };
type Zone = { id: string; name: string };
type DnsRecord = { id: string; type: string; name: string; content: string };
type AssetFile = { relative: string; bytes: Uint8Array; hash: string; contentType: string };

const API = 'https://api.cloudflare.com/client/v4';
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20_000;

class ApiError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

async function cloudflare<T>(auth: AuthProps, route: string, init: RequestInit = {}, bearer = auth.apiToken): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${bearer}`);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(`${API}${route}`, { ...init, headers, signal: AbortSignal.timeout(25_000) }); }
  catch { throw new ApiError('Cloudflare API is unreachable. Check the connection and retry.', 503); }
  let payload: ApiEnvelope<T> | undefined;
  try { payload = await response.json() as ApiEnvelope<T>; } catch { /* report below */ }
  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.map(error => error.message).filter(Boolean).join('; ');
    const message = response.status === 401 ? 'Cloudflare rejected this API token. Reconnect with an active token.'
      : response.status === 403 ? 'This Cloudflare token is missing the permission required for this action. Check Pages Edit and, for DNS changes, Zone Read plus DNS Edit.'
      : response.status === 429 ? 'Cloudflare rate limit reached. Wait briefly and retry.'
      : detail || `Cloudflare API returned HTTP ${response.status}.`;
    throw new ApiError(message, response.status);
  }
  return payload.result;
}

function accountProjects(auth: AuthProps): string {
  return `/accounts/${encodeURIComponent(auth.accountId)}/pages/projects`;
}

async function ensureProject(auth: AuthProps, projectName: string, branch: string): Promise<Project> {
  try { return await cloudflare<Project>(auth, `${accountProjects(auth)}/${encodeURIComponent(projectName)}`); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  return cloudflare<Project>(auth, accountProjects(auth), { method: 'POST', body: JSON.stringify({ name: projectName, production_branch: branch }) });
}

function contentType(file: string): string {
  const ext = file.toLowerCase().split('.').pop() ?? '';
  return ({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain; charset=utf-8', xml: 'application/xml', pdf: 'application/pdf', webmanifest: 'application/manifest+json', wasm: 'application/wasm' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

async function githubBuild(repoUrl: string, branch: string, outputDir: string): Promise<AssetFile[]> {
  let url: URL;
  try { url = new URL(repoUrl); } catch { throw new Error('repo_url must be a public GitHub repository URL such as https://github.com/owner/repo.'); }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || parts.length < 2 || parts[0].startsWith('.') || parts[1].startsWith('.') || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
    throw new Error('Only public GitHub repository URLs are supported for online deployments. Private repositories and arbitrary URLs are not fetched.');
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  const prefixPath = parts[2] === 'tree' ? parts.slice(4).join('/') : '';
  const selectedDir = [prefixPath, outputDir === '.' ? '' : outputDir].filter(Boolean).join('/').replace(/^\/+|\/+$/g, '');
  if (selectedDir.split('/').some(part => part === '..' || part === '.')) throw new Error('output_dir must stay within the repository.');
  const archiveUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch)}`;
  let response: Response;
  try { response = await fetch(archiveUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mcp-cloud-deploy' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Could not download the public GitHub source archive. Check the repository URL and try again.'); }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location || !location.startsWith('https://codeload.github.com/')) throw new Error('GitHub returned an unexpected archive redirect; refusing to fetch it.');
    response = await fetch(location, { headers: { 'User-Agent': 'mcp-cloud-deploy' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok || !response.body) throw new Error(`GitHub could not provide this source archive (HTTP ${response.status}). Confirm the repository is public and the branch exists.`);
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_ARCHIVE_BYTES) throw new Error('The GitHub archive is over the 20 MiB online source limit. Use the local MCP for larger builds.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    downloaded += value.byteLength;
    if (downloaded > MAX_ARCHIVE_BYTES) { await reader.cancel(); throw new Error('The GitHub archive exceeded the 20 MiB online source limit.'); }
    chunks.push(value);
  }
  const zip = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) { zip.set(chunk, offset); offset += chunk.byteLength; }

  const files = new Map<string, AssetFile>();
  const pending: Promise<void>[] = [];
  let rootPrefix = '';
  let extractedBytes = 0;
  let seenFiles = 0;
  let extractionError: Error | undefined;
  const unzip = new Unzip(file => {
    if (extractionError) return;
    seenFiles += 1;
    if (seenFiles > MAX_FILES + 10_000) { extractionError = new Error('This GitHub repository archive contains too many files.'); return; }
    const pathParts = file.name.split('/');
    if (pathParts.some(part => part === '..' || part === '.') || file.name.startsWith('/')) { extractionError = new Error('The repository archive contains an unsafe file path.'); return; }
    if (!rootPrefix) rootPrefix = pathParts[0] ? `${pathParts[0]}/` : '';
    if (!file.name.startsWith(rootPrefix) || file.name.endsWith('/')) return;
    const relative = file.name.slice(rootPrefix.length);
    const selectedPrefix = selectedDir ? `${selectedDir}/` : '';
    if (!relative.startsWith(selectedPrefix)) return;
    const assetPath = relative.slice(selectedPrefix.length);
    if (!assetPath || /(^|\/)\.(?:env|git|github)(?:\/|$)/i.test(assetPath)) return;
    if (file.originalSize === undefined || file.originalSize > MAX_FILE_BYTES) { extractionError = new Error(`A build asset is missing its size or exceeds the 10 MiB per-file limit: ${assetPath}`); return; }
    extractedBytes += file.originalSize;
    if (extractedBytes > MAX_TOTAL_BYTES) { extractionError = new Error('The selected build output exceeds the 50 MiB total online deployment limit.'); return; }
    if (files.size >= MAX_FILES) { extractionError = new Error('Cloudflare Pages supports at most 20,000 files in one deployment.'); return; }
    const data: Uint8Array[] = [];
    let actualBytes = 0;
    const complete = new Promise<void>((resolve, reject) => {
      file.ondata = (error, chunk, final) => {
        if (error) { reject(error); return; }
        actualBytes += chunk.byteLength;
        if (actualBytes > MAX_FILE_BYTES) { reject(new Error(`An asset exceeded the per-file limit: ${assetPath}`)); return; }
        data.push(chunk);
        if (final) {
          const bytes = new Uint8Array(actualBytes);
          let at = 0;
          for (const piece of data) { bytes.set(piece, at); at += piece.byteLength; }
          const extension = assetPath.split('.').pop() ?? '';
          const digest = blake3Hash(`${toBase64(bytes)}${extension}`).toString('hex').slice(0, 32);
          files.set(assetPath, { relative: assetPath, bytes, hash: digest, contentType: contentType(assetPath) });
          resolve();
        }
      };
    });
    pending.push(complete);
    file.start();
  });
  unzip.register(UnzipInflate);
  try { unzip.push(zip, true); } catch { throw extractionError ?? new Error('The GitHub repository archive is invalid or uses an unsupported ZIP compression method.'); }
  await Promise.all(pending);
  if (extractionError) throw extractionError;
  if (!files.has('index.html')) throw new Error(`No index.html was found under "${selectedDir || '/'}". Deploy a public GitHub repository that already contains its built static output, or use the local MCP to build and deploy a local app.`);
  return [...files.values()];
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, Math.min(at + 0x8000, bytes.length)));
  return btoa(binary);
}

function manifestFor(files: AssetFile[]): Record<string, string> {
  return Object.fromEntries(files.map(file => [`/${file.relative}`, file.hash]));
}

async function deployAssets(auth: AuthProps, projectName: string, branch: string, files: AssetFile[], spaMode: boolean) {
  const project = await ensureProject(auth, projectName, branch);
  const assetsPath = accountProjects(auth);
  const uploadToken = (await cloudflare<{ jwt: string }>(auth, `${assetsPath}/${encodeURIComponent(projectName)}/upload-token`)).jwt;
  const unique = new Map<string, AssetFile>();
  for (const file of files) unique.set(file.hash, file);
  const hashes = [...unique.keys()];
  const missing = await cloudflare<string[]>(auth, '/pages/assets/check-missing', { method: 'POST', body: JSON.stringify({ hashes }) }, uploadToken);
  let batch: Array<{ base64: true; key: string; metadata: { contentType: string }; value: string }> = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await cloudflare<unknown>(auth, '/pages/assets/upload', { method: 'POST', body: JSON.stringify(batch) }, uploadToken);
    batch = [];
    batchBytes = 0;
  };
  for (const hash of missing) {
    const file = unique.get(hash);
    if (!file) continue;
    const value = toBase64(file.bytes);
    const encodedBytes = value.length;
    if (batch.length && batchBytes + encodedBytes > 4 * 1024 * 1024) await flush();
    batch.push({ base64: true, key: hash, metadata: { contentType: file.contentType }, value });
    batchBytes += encodedBytes;
  }
  await flush();
  await cloudflare<unknown>(auth, '/pages/assets/upsert-hashes', { method: 'POST', body: JSON.stringify({ hashes }) }, uploadToken);
  const form = new FormData();
  form.set('manifest', JSON.stringify(manifestFor(files)));
  form.set('branch', branch);
  if (spaMode) form.set('_redirects', '/* /index.html 200\n');
  let deployment = await cloudflare<Deployment>(auth, `${assetsPath}/${encodeURIComponent(projectName)}/deployments`, { method: 'POST', body: form });
  let status = deployment.latest_stage?.status ?? 'queued';
  for (let i = 0; i < 20 && !['success', 'failure', 'failed', 'canceled'].includes(status); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    deployment = await cloudflare<Deployment>(auth, `${assetsPath}/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deployment.id)}`);
    status = deployment.latest_stage?.status ?? status;
  }
  if (['failure', 'failed', 'canceled'].includes(status)) throw new Error(`Cloudflare Pages deployment ${status}. Check the build output and retry.`);
  const previewUrl = deployment.url?.startsWith('http') ? deployment.url : `https://${deployment.url || `${deployment.id}.${project.subdomain || `${projectName}.pages.dev`}`}`;
  const productionUrl = `https://${project.subdomain || `${projectName}.pages.dev`}`;
  return { id: deployment.id, status, url: project.production_branch === branch ? productionUrl : previewUrl, timestamp: deployment.created_on ?? new Date().toISOString() };
}

async function attachDomain(auth: AuthProps, projectName: string, domain: string) {
  const base = accountProjects(auth);
  await cloudflare<Project>(auth, `${base}/${encodeURIComponent(projectName)}`);
  try { await cloudflare<DomainBinding>(auth, `${base}/${encodeURIComponent(projectName)}/domains`, { method: 'POST', body: JSON.stringify({ name: domain }) }); }
  catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const current = await cloudflare<DomainBinding[]>(auth, `${base}/${encodeURIComponent(projectName)}/domains`);
    if (!current.some(row => row.name.toLowerCase() === domain.toLowerCase())) throw error;
  }
  const zones = await cloudflare<Zone[]>(auth, `/zones?account.id=${encodeURIComponent(auth.accountId)}&per_page=100`);
  const zone = zones.filter(row => domain === row.name || domain.endsWith(`.${row.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone) return { dns: `Add CNAME at your DNS provider: host ${domain}, target ${projectName}.pages.dev.`, ssl: 'Pending DNS setup and Cloudflare certificate issuance.', status: 'Added to Pages; DNS must be configured externally.' };
  const records = await cloudflare<DnsRecord[]>(auth, `/zones/${encodeURIComponent(zone.id)}/dns_records?name=${encodeURIComponent(domain)}&per_page=100`);
  let dns: string;
  if (records.some(row => row.type === 'CNAME' && row.content === `${projectName}.pages.dev`)) dns = 'Matching CNAME already exists; left unchanged.';
  else if (records.length) dns = `Existing ${records.map(row => row.type).join('/')} DNS record conflicts. Update ${domain} to a CNAME targeting ${projectName}.pages.dev; existing record was left untouched.`;
  else {
    const relativeName = domain === zone.name ? '@' : domain.slice(0, -(zone.name.length + 1));
    await cloudflare<DnsRecord>(auth, `/zones/${encodeURIComponent(zone.id)}/dns_records`, { method: 'POST', body: JSON.stringify({ type: 'CNAME', name: relativeName, content: `${projectName}.pages.dev`, ttl: 1, proxied: true }) });
    dns = `Created proxied CNAME ${domain} → ${projectName}.pages.dev.`;
  }
  const bindings = await cloudflare<DomainBinding[]>(auth, `${base}/${encodeURIComponent(projectName)}/domains`);
  const binding = bindings.find(row => row.name.toLowerCase() === domain.toLowerCase());
  return { dns, ssl: binding?.verification_data?.status ?? 'pending', status: binding?.status ?? 'pending' };
}

function serverFor(auth: AuthProps, scopes: string[]) {
  const server = new McpServer({ name: 'mcp-cloud-deploy', version: '1.1.0' });
  const canWrite = scopes.includes('mcp:write');
  server.registerTool('deploy_to_cloudflare_pages', {
    description: 'Deploy a prebuilt static website from a public GitHub repository to Cloudflare Pages. The selected folder must already contain index.html; this online endpoint does not run arbitrary build scripts.',
    inputSchema: z.object({
      project_name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
      repo_url: z.string().url(),
      branch: z.string().min(1).max(100).default('main'),
      output_dir: z.string().default('.'),
      spa_mode: z.boolean().default(false)
    })
  }, async ({ project_name, repo_url, branch, output_dir, spa_mode }) => {
    if (!canWrite) return { isError: true, content: [{ type: 'text', text: 'Reconnect the MCP and grant deployment access, including the mcp:write scope.' }] };
    const files = await githubBuild(repo_url, branch, output_dir);
    const result = await deployAssets(auth, project_name, branch, files, spa_mode);
    return { content: [{ type: 'text', text: `Deployment ${result.status}\nURL: ${result.url}\nDeployment ID: ${result.id}\nFiles: ${files.length}\nTimestamp: ${result.timestamp}` }] };
  });
  server.registerTool('attach_custom_domain', {
    description: 'Attach a custom domain to a Cloudflare Pages project. If the DNS zone is in this Cloudflare account, create a CNAME only when no conflicting record exists.',
    inputSchema: z.object({ project_name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), domain: z.string().min(3).max(253) })
  }, async ({ project_name, domain }) => {
    if (!canWrite) return { isError: true, content: [{ type: 'text', text: 'Reconnect the MCP and grant deployment access, including the mcp:write scope.' }] };
    const result = await attachDomain(auth, project_name, domain);
    return { content: [{ type: 'text', text: `## Custom domain\n\n- URL: https://${domain}\n- Pages: ${result.status}\n- SSL: ${result.ssl}\n- DNS: ${result.dns}` }] };
  });
  server.registerTool('list_deployments', {
    description: 'List recent Cloudflare Pages deployment status, URLs, and custom-domain bindings.',
    inputSchema: z.object({ project_name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/) })
  }, async ({ project_name }) => {
    const base = `${accountProjects(auth)}/${encodeURIComponent(project_name)}`;
    const [deployments, domains] = await Promise.all([
      cloudflare<Deployment[]>(auth, `${base}/deployments?per_page=10`),
      cloudflare<DomainBinding[]>(auth, `${base}/domains`)
    ]);
    const recent = deployments.length ? deployments.map(item => `- ${item.created_on ?? 'unknown time'} · ${item.latest_stage?.status ?? 'unknown'} · ${item.url ?? item.id}`).join('\n') : '- No deployments found.';
    const bound = domains.length ? domains.map(item => `- ${item.name}: ${item.status ?? 'unknown'}`).join('\n') : '- No custom domains configured.';
    return { content: [{ type: 'text', text: `## ${project_name}\n\n### Recent deployments\n${recent}\n\n### Custom domains\n${bound}` }] };
  });
  return server;
}

const PAGE_SCOPES = ['mcp:write', 'offline_access'];
const escapeHtml = (input: string) => input.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function htmlResponse(body: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Cloudflare · mcp-cloud-deploy</title><style>body{margin:0;background:#f4f6f1;color:#17231c;font:16px/1.6 system-ui,sans-serif}.wrap{max-width:620px;margin:6vh auto;padding:0 20px}.card{background:#fff;border:1px solid #e1e6de;border-radius:18px;padding:28px;box-shadow:0 18px 60px #17231c0c}h1{font-size:28px;line-height:1.1;letter-spacing:-.04em}.muted{color:#637067;font-size:14px}.field{display:grid;gap:6px;margin:16px 0}.field label{font-size:13px;font-weight:700}.field input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cdd6cc;border-radius:9px;font:14px ui-monospace,monospace}.scope{background:#f2f5ed;border-radius:9px;padding:12px;font-size:13px}.actions{display:flex;gap:10px;margin-top:20px}.actions button{border:0;border-radius:9px;background:#17231c;color:#fff;padding:12px 16px;font-weight:700;cursor:pointer}.actions .deny{background:#eef1eb;color:#253228}.warning{border-left:3px solid #a6c85d;padding:10px 12px;background:#f4f7ee;font-size:13px}.err{background:#fff0ed;border:1px solid #ffd4c9;color:#853d2e;padding:10px;border-radius:8px;font-size:13px}</style><main class="wrap"><section class="card">${body}</section></main></html>`, { headers });
}

async function validateCredentials(accountId: string, apiToken: string): Promise<void> {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Account ID phải gồm đúng 32 ký tự hexadecimal.');
  if (apiToken.length < 20 || apiToken.length > 4096 || /\s/.test(apiToken)) throw new Error('API Token có định dạng không hợp lệ.');
  const verify = await fetch(`${API}/user/tokens/verify`, { headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(12_000) });
  if (!verify.ok) throw new Error('Cloudflare không xác nhận được API Token. Kiểm tra token còn hoạt động rồi thử lại.');
  const verification = await verify.json() as { success?: boolean; result?: { status?: string } };
  if (!verification.success || verification.result?.status !== 'active') throw new Error('API Token Cloudflare không ở trạng thái active.');
  const account = await fetch(`${API}/accounts/${encodeURIComponent(accountId)}/pages/projects?per_page=1`, { headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(12_000) });
  if (account.status === 401 || account.status === 403) throw new Error('Token thiếu quyền Pages Read/Edit hoặc không có quyền với Account ID này.');
  if (!account.ok) throw new Error('Không truy cập được Cloudflare Pages account. Hãy kiểm tra Account ID và quyền token.');
  const payload = await account.json() as { success?: boolean };
  if (!payload.success) throw new Error('Cloudflare API không chấp nhận account này.');
}

async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  let authRequest;
  try { authRequest = await oauth.parseAuthRequest(request); }
  catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return error.redirectTo ? Response.redirect(error.redirectTo, 302) : new Response(error.description, { status: 400 });
  }
  const details = await oauth.describeConsent(authRequest);
  if (request.method === 'POST') {
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') === 'deny') {
      const denied = await oauth.denyConsent(request, handle);
      const headers = new Headers(denied.headers);
      headers.set('Location', denied.redirectTo);
      return new Response(null, { status: 302, headers });
    }
    const approved = await oauth.approveConsent(request, handle, { scope: authRequest.scope.filter(scope => PAGE_SCOPES.includes(scope)) });
    const accountId = String(form.get('account_id') ?? '').trim();
    const apiToken = String(form.get('api_token') ?? '').trim();
    try {
      await validateCredentials(accountId, apiToken);
    } catch (error) {
      const transaction = await oauth.beginConsent(approved.request);
      const message = error instanceof Error ? error.message : 'Không thể xác minh thông tin Cloudflare.';
      const body = renderConsent(details, transaction.handle, message, accountId);
      return htmlResponse(body, transaction.headers);
    }
    const completed = await oauth.completeAuthorization({ request: approved.request, userId: accountId, metadata: { provider: 'cloudflare' }, scope: approved.request.scope.filter(scope => PAGE_SCOPES.includes(scope)), props: { accountId, apiToken } satisfies AuthProps });
    const headers = new Headers(approved.headers);
    headers.set('Location', completed.redirectTo);
    return new Response(null, { status: 302, headers });
  }
  const transaction = await oauth.beginConsent(authRequest);
  return htmlResponse(renderConsent(details, transaction.handle), transaction.headers);
}

function renderConsent(details: { clientName: string; clientDomain?: string; redirectHost: string; redirectIsLoopback: boolean; scope: string[] }, handle: string, error = '', accountId = ''): string {
  const scopes = details.scope.filter(scope => PAGE_SCOPES.includes(scope));
  return `<p class="muted">Kết nối MCP · Cloudflare</p><h1>Cấp quyền Cloudflare cho mcp-cloud-deploy</h1><p>Client <b>${escapeHtml(details.clientName)}</b>${details.clientDomain ? ` · domain xác thực ${escapeHtml(details.clientDomain)}` : ''} yêu cầu kết nối. OAuth token sẽ quay lại ứng dụng tại <b>${escapeHtml(details.redirectHost)}</b>${details.redirectIsLoopback ? ' (ứng dụng cục bộ trên máy bạn)' : ''}.</p><p class="scope">Quyền MCP yêu cầu: ${scopes.map(escapeHtml).join(', ') || 'không có scope hợp lệ'}. Các thao tác Cloudflare còn bị giới hạn bởi quyền của API Token bạn nhập bên dưới.</p><p class="warning"><b>Bảo mật:</b> API Token được gửi qua HTTPS tới Cloudflare Worker này và lưu mã hóa trong OAuth store để gọi Cloudflare API thay bạn. Dùng token giới hạn đúng account; không dùng Global API Key. Bạn có thể thu hồi token tại Cloudflare bất cứ lúc nào.</p>${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}<form method="post" autocomplete="off"><input type="hidden" name="handle" value="${escapeHtml(handle)}"><div class="field"><label for="account_id">Cloudflare Account ID</label><input id="account_id" name="account_id" required value="${escapeHtml(accountId)}" placeholder="32 ký tự hexadecimal" autocomplete="off"></div><div class="field"><label for="api_token">Cloudflare API Token</label><input id="api_token" name="api_token" type="password" required placeholder="Dán token Cloudflare của bạn" autocomplete="new-password"></div><p class="muted">Tối thiểu: Account → Cloudflare Pages → Edit. Để tự cấu hình DNS, thêm Zone → Zone → Read và Zone → DNS → Edit cho zone cần dùng.</p><div class="actions"><button type="submit" name="decision" value="allow">Xác minh &amp; kết nối</button><button class="deny" type="submit" name="decision" value="deny" formnovalidate>Hủy</button></div></form>`;
}

function createProvider(origin: string) {
  const mcpUrl = `${origin}/mcp`;
  const apiHandler = {
    async fetch(request: Request, _env: Env, ctx: ExecutionContext) {
      const authContext = ctx as ExecutionContext & { props: AuthProps; auth: { scope: string[] } };
      const handler = createMcpHandler(() => serverFor(authContext.props, authContext.auth.scope), { authContext: { props: authContext.props } });
      return handler.fetch(request);
    }
  };
  const defaultHandler = {
    async fetch(request: Request, env: Env) {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/authorize') return authorize(request, env);
      if (pathname === '/') return new Response('mcp-cloud-deploy remote MCP endpoint. Connect an MCP client to /mcp.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return new Response('Not found', { status: 404 });
    }
  };
  return new OAuthProvider<Env>({
    apiRoute: '/mcp', apiHandler, defaultHandler, authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token',
    scopesSupported: PAGE_SCOPES, requiredScopes: ['mcp:write'],
    resourceMetadata: { resource: mcpUrl, authorization_servers: [origin] },
    clientIdMetadataDocumentEnabled: true
  });
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const host = request.headers.get('host');
    const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (host?.toLowerCase() !== url.host.toLowerCase() || (!isLocal && !url.hostname.endsWith('.workers.dev'))) {
      return new Response('Invalid host', { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const origin = url.origin;
    return createProvider(origin).fetch(request, env, ctx);
  }
};
