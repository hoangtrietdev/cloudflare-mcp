import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Redis } from '@upstash/redis';

export type CloudflareCredentials = { accountId: string; apiToken: string };
export type OAuthClient = { client_id: string; client_name?: string; redirect_uris: string[]; token_endpoint_auth_method: 'none' };
export type OAuthGrant = { id: string; clientId: string; credentials: string; scope: string; accountId: string };

let redisClient: Redis | undefined;
function redis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('OAuth storage is not configured. Connect Upstash Redis and provide its REST URL and write token.');
  return redisClient ??= new Redis({ url, token });
}
const secretKey = (): Buffer => {
  const value = process.env.MCP_CREDENTIALS_ENCRYPTION_KEY;
  if (!value) throw new Error('MCP_CREDENTIALS_ENCRYPTION_KEY is not configured.');
  const key = Buffer.from(value, 'base64');
  if (key.byteLength !== 32) throw new Error('MCP_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
};
export const opaqueToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export async function seal(value: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export async function unseal(value: string): Promise<string> {
  const [iv, tag, data] = value.split('.');
  if (!iv || !tag || !data) throw new Error('Stored credential is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
export const oauthDb = {
  async get<T>(key: string): Promise<T | null> { return await redis().get<T>(key); },
  async consume<T>(key: string): Promise<T | null> { return await redis().getdel<T>(key); },
  async put(key: string, value: unknown, seconds: number): Promise<void> { await redis().set(key, value, { ex: seconds }); },
  async del(...keys: string[]): Promise<void> { if (keys.length) await redis().del(...keys); },
  async addToSet(key: string, value: string, seconds: number): Promise<void> { await redis().sadd(key, value); await redis().expire(key, seconds); },
  async setMembers(key: string): Promise<string[]> { return await redis().smembers(key); }
};
