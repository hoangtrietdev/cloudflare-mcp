# Privacy policy

This policy covers the hosted MCP service when operated by the project maintainer. For a self-hosted deployment, the operator controls the service and its data.

## Data handled by the hosted service

- OAuth client metadata and authorization grants needed to connect an MCP client.
- Your Cloudflare Account ID and API Token entered on the HTTPS consent page.
- Public GitHub repository URL, branch, and deployment requests submitted to MCP tools.

## How credentials are protected and used

The service validates your Cloudflare API Token and uses it only for the Cloudflare Pages, DNS, and deployment operations you request. Before credentials are written to Upstash Redis, the app encrypts them with AES-256-GCM using the operator-managed `MCP_CREDENTIALS_ENCRYPTION_KEY`. Redis stores OAuth grants and hashed access/refresh token indexes. Access tokens expire after one hour; refresh grants expire after 30 days and are rotated on use. Revoke the MCP authorization to delete a grant, or revoke the Cloudflare API Token in your Cloudflare dashboard to invalidate the upstream credential immediately.

Tokens are not included in MCP tool responses or application logs. The app fetches public build archives only from GitHub (`api.github.com` and `codeload.github.com`), processes them in a request, and sends static assets to Cloudflare Pages. It does not run repository build scripts.

## Third-party processors and retention

Vercel hosts the application; Upstash stores encrypted OAuth data. Cloudflare processes the requested account changes and retains deployments/DNS records under its own policies. OAuth records remain until revoked or their 30-day refresh TTL expires. Public source archives are not intentionally retained after deployment requests complete.

## Your choices and security

Use a dedicated Cloudflare API Token with minimum account/zone permissions. Never use a Global API Key. Connecting means the hosted service operator processes the token you submit; do not connect if you do not trust the operator. For a self-hosted version, use your own Vercel project, Redis database, and encryption key.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md). This project does not sell data or use advertising analytics.
