import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const runtime = 'nodejs';
export async function GET() {
  const page = await readFile(path.join(process.cwd(), 'public/terms/index.html'));
  return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}
