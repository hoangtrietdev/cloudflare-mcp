export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Serves the OpenAI plugin-portal domain verification token at /.well-known/openai-apps-challenge
// (rewritten in vercel.json). Set OPENAI_APPS_CHALLENGE_TOKEN in Vercel to the token the portal shows.
export async function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (!token) return new Response('Not found', { status: 404 });
  return new Response(token, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
