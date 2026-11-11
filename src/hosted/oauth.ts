import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getPublicOrigin } from 'mcp-handler';
import { CloudflareClient } from '../services/cloudflare.js';
import { oauthDb, opaqueToken, seal, tokenHash, unseal, type CloudflareCredentials, type OAuthClient, type OAuthGrant } from './oauth-store.js';

const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 60 * 60 * 24 * 30;
const CODE_TTL = 180;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Access-Control-Allow-Origin': '*' } });
const error = (message: string, status = 400) => json({ error: message }, status);
const html = (body: string, status = 200) => new Response(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Cloudflare · mcp-cloud-deploy</title><style>body{margin:0;background:#07111f;color:#f1f6fd;font:16px/1.6 system-ui,sans-serif}.wrap{max-width:620px;margin:6vh auto;padding:0 20px}.card{background:#0d1a2b;border:1px solid #203650;border-radius:18px;padding:28px;box-shadow:0 18px 60px #0006}h1{font-size:28px;line-height:1.1;letter-spacing:-.04em}.muted{color:#a5b6cb;font-size:14px}.field{display:grid;gap:6px;margin:16px 0}.field label{font-size:13px;font-weight:700}.field input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #29425d;border-radius:9px;background:#081421;color:#f1f6fd;font:14px ui-monospace,monospace}.scope,.warning{border-radius:9px;padding:12px;font-size:13px}.scope{background:#10243a;color:#c5d9ee}.warning{border-left:3px solid #56a8ff;background:#10243a;color:#b5c8dd}.actions{display:flex;gap:10px;margin-top:20px}.actions button{border:0;border-radius:9px;background:#2379cf;color:white;padding:12px 16px;font-weight:700;cursor:pointer}.actions .deny{background:#1a2a3d;color:#d5e5f6}.err{background:#351f27;border:1px solid #70404c;color:#ffd6dd;padding:10px;border-radius:8px;font-size:13px}</style><main class="wrap"><section class="card">${body}</section></main></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
const origin = (request: Request) => getPublicOrigin(request);
function redisFailure(): Response { return error('OAuth storage is temporarily unavailable. Please retry later.', 503); }

export async function discovery(request: Request): Promise<Response> {
  const base = origin(request);
  return json({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mcp:write'] });
}

export async function registerClient(request: Request): Promise<Response> {
  try {
    const input = await request.json() as Partial<OAuthClient>;
    if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length < 1 || input.redirect_uris.length > 20 || input.redirect_uris.some(uri => !safeRedirect(uri))) return error('redirect_uris must contain HTTPS or loopback callback URLs.');
    const client: OAuthClient = { client_id: opaqueToken(), client_name: typeof input.client_name === 'string' ? input.client_name.slice(0, 120) : 'MCP client', redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none' };
    await oauthDb.put(`oauth:client:${client.client_id}`, client, 60 * 60 * 24 * 365);
    return json({ ...client, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now()/1000), client_secret_expires_at: 0 }, 201);
  } catch { return redisFailure(); }
}
function safeRedirect(input: string): boolean {
  try { const url = new URL(input); return url.protocol === 'https:' || (['http:'].includes(url.protocol) && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)); } catch { return false; }
}
type AuthTxn = { client: OAuthClient; redirectUri: string; state: string; challenge: string; scope: string; resource: string; nonce: string };
export async function authorize(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') ?? '';
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const challenge = url.searchParams.get('code_challenge') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const responseType = url.searchParams.get('response_type');
  const scope = url.searchParams.get('scope') ?? 'mcp:write';
  const resource = url.searchParams.get('resource') ?? `${origin(request)}/api/mcp`;
  try {
    const client = await oauthDb.get<OAuthClient>(`oauth:client:${clientId}`);
    const resourceUrl = new URL(resource);
    if (!client || responseType !== 'code' || !client.redirect_uris.includes(redirectUri) || !safeRedirect(redirectUri) || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || !state || !scope.split(' ').includes('mcp:write') || resourceUrl.origin !== origin(request) || resourceUrl.pathname !== '/api/mcp') return error('OAuth authorization request is invalid. Reconnect the MCP client.', 400);
    const handle = opaqueToken();
    const txn: AuthTxn = { client, redirectUri, state, challenge, scope: 'mcp:write', resource, nonce: opaqueToken() };
    await oauthDb.put(`oauth:txn:${handle}`, txn, 600);
    return html(`<p class="muted">Kết nối MCP · Cloudflare</p><h1>Cấp quyền cho ${esc(client.client_name ?? 'MCP client')}</h1><p>Client callback: <b>${esc(new URL(redirectUri).host)}</b>. Nhập Cloudflare Account ID và API Token riêng của bạn. Token giới hạn quyền trong tài khoản/zone bạn cấp.</p><p class="scope">Yêu cầu: Cloudflare Pages Edit để deploy. Thêm Zone Read và DNS Edit chỉ khi muốn tự tạo DNS record.</p><p class="warning"><b>Bảo mật:</b> thông tin được gửi qua HTTPS và mã hóa trong kho OAuth để thực hiện yêu cầu của bạn. Không dùng Global API Key. Thu hồi grant hoặc Cloudflare API Token bất cứ lúc nào.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${esc(handle)}"><div class="field"><label for="account_id">Cloudflare Account ID</label><input id="account_id" name="account_id" required pattern="[A-Fa-f0-9]{32}" autocomplete="off"></div><div class="field"><label for="api_token">Cloudflare API Token</label><input id="api_token" name="api_token" type="password" required autocomplete="new-password"></div><div class="actions"><button name="decision" value="allow">Xác minh và kết nối</button><button class="deny" name="decision" value="deny" formnovalidate>Hủy</button></div></form>`);
  } catch { return redisFailure(); }
}
async function validateCredentials(accountId: string, apiToken: string) {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Account ID phải có đúng 32 ký tự hexadecimal.');
  if (apiToken.length < 20 || apiToken.length > 4096 || /\s/.test(apiToken)) throw new Error('API Token không đúng định dạng.');
  const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(12_000) });
  const data = await response.json().catch(() => null) as { success?: boolean; result?: { status?: string } } | null;
  if (!response.ok || data?.success !== true || data.result?.status !== 'active') throw new Error('Cloudflare không xác nhận được token. Kiểm tra token còn hiệu lực và thử lại.');
  const client = new CloudflareClient(apiToken, accountId);
  try { await client.listProject('__mcp_permission_probe__'); }
  catch (err) {
    if (err instanceof Error && !/HTTP 404|not found/i.test(err.message)) {
      if (/Authentication failed|401|403/i.test(err.message)) throw new Error('Token thiếu Cloudflare Pages Read/Edit hoặc Account ID không khớp.');
    }
  }
}
export async function submitConsent(request: Request): Promise<Response> {
  let txn: AuthTxn | null = null;
  let handle = '';
  let accountId = '';
  try {
    const form = await request.formData();
    handle = String(form.get('handle') ?? ''); accountId = String(form.get('account_id') ?? '').trim();
    txn = await oauthDb.get<AuthTxn>(`oauth:txn:${handle}`);
    if (!txn) return error('OAuth request expired. Reconnect the MCP client.', 400);
    if (form.get('decision') === 'deny') return redirectWithError(txn, 'access_denied', 'You denied authorization.');
    const apiToken = String(form.get('api_token') ?? '').trim();
    try { await validateCredentials(accountId, apiToken); }
    catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to validate Cloudflare access.';
      return html(`<p class="muted">Cloudflare verification</p><h1>Không thể xác minh</h1><p class="err">${esc(message)}</p><p class="muted">Hãy quay lại MCP client và bắt đầu kết nối lại để thử với token/Account ID đúng.</p>`, 400);
    }
    await oauthDb.del(`oauth:txn:${handle}`);
    const code = opaqueToken();
    const codeData = { ...txn, accountId, credentials: await seal(JSON.stringify({ accountId, apiToken } satisfies CloudflareCredentials)) };
    await oauthDb.put(`oauth:code:${tokenHash(code)}`, codeData, CODE_TTL);
    const callback = new URL(txn.redirectUri); callback.searchParams.set('code', code); callback.searchParams.set('state', txn.state);
    return new Response(null, { status: 302, headers: { Location: callback.toString(), 'Cache-Control': 'no-store' } });
  } catch { return redisFailure(); }
}
function redirectWithError(txn: AuthTxn, name: string, description: string) {
  const url = new URL(txn.redirectUri); url.searchParams.set('error', name); url.searchParams.set('error_description', description); url.searchParams.set('state', txn.state);
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store' } });
}
function equalText(a: string, b: string): boolean { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
type CodeData = AuthTxn & { accountId: string; credentials: string };
async function issueGrant(data: CodeData, clientId: string) {
  const id = opaqueToken();
  const grant: OAuthGrant = { id, clientId, credentials: data.credentials, scope: data.scope, accountId: data.accountId };
  const access = opaqueToken(); const refresh = opaqueToken();
  await oauthDb.put(`oauth:grant:${id}`, grant, REFRESH_TTL);
  await oauthDb.put(`oauth:access:${tokenHash(access)}`, id, ACCESS_TTL);
  await oauthDb.put(`oauth:refresh:${tokenHash(refresh)}`, id, REFRESH_TTL);
  await oauthDb.addToSet(`oauth:grant-tokens:${id}`, tokenHash(access), REFRESH_TTL);
  await oauthDb.addToSet(`oauth:grant-tokens:${id}`, tokenHash(refresh), REFRESH_TTL);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: data.scope };
}
export async function token(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const grantType = String(form.get('grant_type') ?? ''); const clientId = String(form.get('client_id') ?? '');
    if (grantType === 'authorization_code') {
      const code = String(form.get('code') ?? ''); const verifier = String(form.get('code_verifier') ?? ''); const redirectUri = String(form.get('redirect_uri') ?? '');
      if (!code || verifier.length < 43 || verifier.length > 128) return error('invalid_grant', 400);
      const codeData = await oauthDb.consume<CodeData>(`oauth:code:${tokenHash(code)}`);
      if (!codeData || codeData.client.client_id !== clientId || codeData.redirectUri !== redirectUri || !equalText(pkceChallenge(verifier), codeData.challenge)) return error('invalid_grant', 400);
      return json(await issueGrant(codeData, clientId));
    }
    if (grantType === 'refresh_token') {
      const refresh = String(form.get('refresh_token') ?? ''); const key = `oauth:refresh:${tokenHash(refresh)}`;
      const id = await oauthDb.get<string>(key); if (!id) return error('invalid_grant', 400);
      const grant = await oauthDb.get<OAuthGrant>(`oauth:grant:${id}`);
      if (!grant || grant.clientId !== clientId) return error('invalid_grant', 400);
      await oauthDb.del(key);
      const access = opaqueToken(); const nextRefresh = opaqueToken();
      await oauthDb.put(`oauth:grant:${id}`, grant, REFRESH_TTL);
      await oauthDb.put(`oauth:access:${tokenHash(access)}`, id, ACCESS_TTL);
      await oauthDb.put(`oauth:refresh:${tokenHash(nextRefresh)}`, id, REFRESH_TTL);
      await oauthDb.addToSet(`oauth:grant-tokens:${id}`, tokenHash(access), REFRESH_TTL);
      await oauthDb.addToSet(`oauth:grant-tokens:${id}`, tokenHash(nextRefresh), REFRESH_TTL);
      return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: nextRefresh, scope: grant.scope });
    }
    return error('unsupported_grant_type', 400);
  } catch { return redisFailure(); }
}
export async function revoke(request: Request): Promise<Response> {
  try {
    const form = await request.formData(); const token = String(form.get('token') ?? '');
    const hashed = tokenHash(token); const id = await oauthDb.get<string>(`oauth:access:${hashed}`) ?? await oauthDb.get<string>(`oauth:refresh:${hashed}`);
    if (id) {
      const hashes = await oauthDb.setMembers(`oauth:grant-tokens:${id}`);
      await oauthDb.del(`oauth:grant:${id}`, `oauth:grant-tokens:${id}`, ...hashes.flatMap(hash => [`oauth:access:${hash}`, `oauth:refresh:${hash}`]));
    }
    return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return error('OAuth revocation storage is unavailable.', 503); }
}
export async function authenticateAccessToken(token: string) {
  const id = await oauthDb.get<string>(`oauth:access:${tokenHash(token)}`);
  if (!id) return undefined;
  const grant = await oauthDb.get<OAuthGrant>(`oauth:grant:${id}`);
  if (!grant) return undefined;
  const credentials = JSON.parse(await unseal(grant.credentials)) as CloudflareCredentials;
  return { grant, credentials };
}
