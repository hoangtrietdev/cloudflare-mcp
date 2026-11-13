type TokenVerification = { success?: boolean; result?: { status?: string } };

/** Validate user-owned and account-owned Cloudflare API tokens with their matching endpoints. */
export async function verifyCloudflareApiToken(accountId: string, apiToken: string): Promise<void> {
  const endpoint = apiToken.startsWith('cfat_')
    ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`
    : 'https://api.cloudflare.com/client/v4/user/tokens/verify';

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(12_000)
    });
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    throw new Error(timeout
      ? 'Cloudflare token verification timed out. Try again.'
      : 'Could not reach Cloudflare to verify the API token. Check connectivity and try again.');
  }

  const data = await response.json().catch(() => null) as TokenVerification | null;
  if (!response.ok || data?.success !== true || data.result?.status !== 'active') {
    throw new Error('Cloudflare did not confirm an active API token. Check its type, expiry, and account.');
  }
}
