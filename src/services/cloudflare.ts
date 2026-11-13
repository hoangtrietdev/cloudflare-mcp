import { hash as blake3Hash } from 'blake3-wasm';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import { createPagesManifest, withSpaFallback } from '../assets.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 200 * 1024 * 1024;
const MAX_ASSET_COUNT = 20_000;
const SKIPPED_DIRECTORIES = new Set(['.git', '.vercel', '.wrangler', 'node_modules']);
const SENSITIVE_FILE_NAMES = new Set(['.npmrc', '.netrc', 'id_rsa', 'id_ed25519']);

function isSensitiveFile(relative: string): boolean {
  const name = path.basename(relative).toLowerCase();
  return name === '.env' || name.startsWith('.env.') || SENSITIVE_FILE_NAMES.has(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);
}

type ApiEnvelope<T> = { success: boolean; result: T; errors?: Array<{ code?: number; message?: string }> };
type PagesProject = { name: string; subdomain?: string; production_branch?: string };
type PagesDeployment = { id: string; url?: string; environment?: string; latest_stage?: { status?: string }; created_on?: string };
type PagesDomain = { name: string; status?: string; verification_data?: { status?: string } };
type Zone = { id: string; name: string };
type DnsRecord = { id: string; type: string; name: string; content: string; proxied?: boolean };
type UploadAsset = { base64: true; key: string; metadata: { contentType: string }; value: string };

export class CloudflareError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'CloudflareError'; }
}

export class CloudflareClient {
  private readonly token: string;
  private readonly accountId: string;

  constructor(token = process.env.CLOUDFLARE_API_TOKEN, accountId = process.env.CLOUDFLARE_ACCOUNT_ID) {
    if (!token || !accountId) throw new CloudflareError('Cloudflare credentials are missing. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment or a local .env file.');
    this.token = token;
    this.accountId = accountId;
  }

  private async request<T>(route: string, init: RequestInit = {}, bearer = this.token): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${bearer}`);
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${route}`, { ...init, headers, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'request timed out' : 'network request failed';
      throw new CloudflareError(`Cloudflare ${reason}. Check connectivity and try again.`);
    }
    let payload: ApiEnvelope<T> | undefined;
    try { payload = await response.json() as ApiEnvelope<T>; } catch { /* handled below */ }
    if (!response.ok || !payload?.success) {
      const details = payload?.errors?.map(e => e.message).filter(Boolean).join('; ');
      const code = response.status === 401 || response.status === 403
        ? 'Authentication failed or token lacks the required Cloudflare permissions. Check the API token.'
        : response.status === 429 ? 'Cloudflare rate limit reached. Wait briefly and retry.'
        : details || `Cloudflare API returned HTTP ${response.status}.`;
      throw new CloudflareError(code, response.status);
    }
    return payload.result;
  }

  private accountRoute(project?: string): string {
    const base = `/accounts/${encodeURIComponent(this.accountId)}/pages/projects`;
    return project ? `${base}/${encodeURIComponent(project)}` : base;
  }

  async getProject(name: string): Promise<PagesProject> {
    return this.request<PagesProject>(this.accountRoute(name));
  }

  async ensureProject(name: string, productionBranch = 'main'): Promise<PagesProject> {
    try { return await this.request<PagesProject>(this.accountRoute(name)); }
    catch (error) {
      if (!(error instanceof CloudflareError) || error.status !== 404) throw error;
    }
    return this.request<PagesProject>(this.accountRoute(), { method: 'POST', body: JSON.stringify({ name, production_branch: productionBranch }) });
  }

  async deploy(projectName: string, dirPath: string, branch: string, options: { spaMode?: boolean } = {}): Promise<{ url: string; status: string; timestamp: string; id: string }> {
    const root = path.resolve(dirPath);
    let rootInfo;
    try { rootInfo = await stat(root); } catch { throw new Error(`Build directory not found: ${root}. Build your app first and pass the directory containing index.html.`); }
    if (!rootInfo.isDirectory()) throw new Error(`Build path is not a directory: ${root}`);
    const entries: Array<{ relative: string; bytes: Buffer; hash: string; contentType: string }> = [];
    const controlFiles = new Map<string, Buffer>();
    let totalBytes = 0;
    const makeEntry = (relative: string, bytes: Buffer) => {
      const extension = path.extname(relative).slice(1);
      const hash = blake3Hash(`${bytes.toString('base64')}${extension}`).toString('hex').slice(0, 32);
      return { relative, bytes, hash, contentType: mime.lookup(relative) || 'application/octet-stream' };
    };
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
          if (path.relative(root, absolute) === 'functions') {
            throw new Error('This MCP server deploys static build output only. It does not bundle Cloudflare Pages Functions or server-side code. Export a static build and pass that directory.');
          }
          await walk(absolute);
        } else if (entry.isFile()) {
          const relative = path.relative(root, absolute).split(path.sep).join('/');
          if (isSensitiveFile(relative)) throw new Error('Refusing to deploy a file that may contain credentials: ' + relative + '. Remove it from the build output and deploy again.');
          const info = await stat(absolute);
          if (info.size > MAX_ASSET_BYTES) throw new Error('Asset exceeds the 25 MiB direct-upload limit: ' + relative);
          totalBytes += info.size;
          if (totalBytes > MAX_TOTAL_ASSET_BYTES) throw new Error('Build output exceeds the 200 MiB local deployment safety limit. Reduce the output or deploy smaller assets.');
          if (entries.length + controlFiles.size >= MAX_ASSET_COUNT) throw new Error('Cloudflare Pages Direct Upload supports at most 20,000 files per deployment.');
          const bytes = await readFile(absolute);
          if (['_redirects', '_headers', '_routes.json', '_worker.js'].includes(relative)) controlFiles.set(relative, bytes);
          else entries.push(makeEntry(relative, bytes));
        }
      }
    };
    await walk(root);
    if (!entries.some(file => file.relative === 'index.html')) throw new Error(`No index.html found in ${root}. Point dir_path at the built static site folder (for example ./dist).`);
    if (options.spaMode) {
      const existingRules = controlFiles.get('_redirects')?.toString('utf8');
      controlFiles.set('_redirects', Buffer.from(withSpaFallback(existingRules)));
    }
    const manifest = createPagesManifest(entries);
    const project = await this.ensureProject(projectName, branch);
    const unique = new Map<string, Buffer>();
    for (const file of entries) unique.set(file.hash, file.bytes);

    const uploadTokenResult = await this.request<{ jwt: string }>(`${this.accountRoute(projectName)}/upload-token`);
    const uploadToken = uploadTokenResult.jwt;
    const missing = await this.request<string[]>('/pages/assets/check-missing', {
      method: 'POST', body: JSON.stringify({ hashes: [...unique.keys()] })
    }, uploadToken);
    const byHash = new Map(entries.map(file => [file.hash, file]));
    let batch: UploadAsset[] = [];
    let batchBytes = 0;
    const flush = async (): Promise<void> => {
      if (!batch.length) return;
      await this.request<unknown>('/pages/assets/upload', { method: 'POST', body: JSON.stringify(batch) }, uploadToken);
      batch = [];
      batchBytes = 0;
    };
    for (const hash of missing) {
      const file = byHash.get(hash);
      if (!file) continue;
      const encodedBytes = Math.ceil(file.bytes.byteLength * 4 / 3);
      if (batch.length && batchBytes + encodedBytes > 4 * 1024 * 1024) await flush();
      batch.push({ base64: true, key: hash, metadata: { contentType: file.contentType }, value: file.bytes.toString('base64') });
      batchBytes += encodedBytes;
    }
    await flush();
    await this.request<unknown>('/pages/assets/upsert-hashes', {
      method: 'POST', body: JSON.stringify({ hashes: [...unique.keys()] })
    }, uploadToken);

    const form = new FormData();
    form.set('manifest', JSON.stringify(manifest));
    form.set('branch', branch);
    for (const [name, bytes] of controlFiles) form.set(name, new Blob([new Uint8Array(bytes)]), name);
    let deployment = await this.request<PagesDeployment>(`${this.accountRoute(projectName)}/deployments`, { method: 'POST', body: form });
    let status = deployment.latest_stage?.status ?? 'queued';
    for (let attempt = 0; attempt < 15 && !['success', 'failure', 'failed', 'canceled'].includes(status); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      deployment = await this.request<PagesDeployment>(`${this.accountRoute(projectName)}/deployments/${encodeURIComponent(deployment.id)}`);
      status = deployment.latest_stage?.status ?? status;
    }
    if (['failure', 'failed', 'canceled'].includes(status)) throw new CloudflareError(`Cloudflare Pages deployment ${status}. Check the build output and try again.`);
    const deploymentUrl = deployment.url ? (deployment.url.startsWith('http') ? deployment.url : `https://${deployment.url}`) : `https://${deployment.id}.${project.subdomain || `${projectName}.pages.dev`}`;
    const projectUrl = `https://${project.subdomain || `${projectName}.pages.dev`}`;
    const url = project.production_branch === branch ? projectUrl : deploymentUrl;
    return { id: deployment.id, url, status, timestamp: deployment.created_on ?? new Date().toISOString() };
  }

  async attachDomain(projectName: string, domain: string): Promise<{ projectUrl: string; zone?: string; dnsAction: string; domainStatus: string; sslStatus: string }> {
    await this.getProject(projectName);
    try {
      await this.request<PagesDomain>(`${this.accountRoute(projectName)}/domains`, { method: 'POST', body: JSON.stringify({ name: domain }) });
    } catch (error) {
      // Cloudflare reports duplicate bindings as an API error; confirm that it is already present.
      if (!(error instanceof CloudflareError)) throw error;
      const existing = await this.request<PagesDomain[]>(`${this.accountRoute(projectName)}/domains`);
      if (!existing.some(item => item.name.toLowerCase() === domain.toLowerCase())) throw error;
    }
    const zones = await this.request<Zone[]>(`/zones?account.id=${encodeURIComponent(this.accountId)}&per_page=100`);
    const zone = zones.filter(item => domain === item.name || domain.endsWith(`.${item.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
    if (!zone) return { projectUrl: `https://${domain}`, dnsAction: `Add a CNAME record at your DNS provider: name/host: ${domain}; target/value: ${projectName}.pages.dev; TTL: Auto (or 300).`, domainStatus: 'Added to Pages; DNS must be configured externally.', sslStatus: 'Pending DNS propagation and Cloudflare certificate issuance.' };

    const relativeName = domain === zone.name ? '@' : domain.slice(0, -(zone.name.length + 1));
    const records = await this.request<DnsRecord[]>(`/zones/${encodeURIComponent(zone.id)}/dns_records?name=${encodeURIComponent(domain)}&per_page=100`);
    let dnsAction: string;
    if (records.some(record => record.type === 'CNAME' && record.content === `${projectName}.pages.dev`)) dnsAction = 'Matching CNAME already exists; left unchanged.';
    else if (records.length) dnsAction = `An existing ${records.map(record => record.type).join('/')} DNS record for ${domain} conflicts. Update it to a CNAME targeting ${projectName}.pages.dev in Cloudflare DNS; it was left unchanged.`;
    else {
      await this.request<DnsRecord>(`/zones/${encodeURIComponent(zone.id)}/dns_records`, { method: 'POST', body: JSON.stringify({ type: 'CNAME', name: relativeName, content: `${projectName}.pages.dev`, ttl: 1, proxied: true }) });
      dnsAction = `Created proxied CNAME ${domain} → ${projectName}.pages.dev.`;
    }
    const domains = await this.request<PagesDomain[]>(`${this.accountRoute(projectName)}/domains`);
    const binding = domains.find(item => item.name.toLowerCase() === domain.toLowerCase());
    return { projectUrl: `https://${domain}`, zone: zone.name, dnsAction, domainStatus: binding?.status ?? 'pending', sslStatus: binding?.verification_data?.status ?? 'pending' };
  }

  async listProject(projectName: string): Promise<{ deployments: PagesDeployment[]; domains: PagesDomain[] }> {
    await this.getProject(projectName);
    const [deployments, domains] = await Promise.all([
      this.request<PagesDeployment[]>(`${this.accountRoute(projectName)}/deployments?per_page=10`),
      this.request<PagesDomain[]>(`${this.accountRoute(projectName)}/domains`)
    ]);
    return { deployments, domains };
  }
}
