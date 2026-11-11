import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const page = await readFile(path.join(process.cwd(), 'public/index.html'));
  return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}
