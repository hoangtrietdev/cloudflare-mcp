# mcp-cloud-deploy

[![CI](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Deploy static websites to Cloudflare Pages from Codex, VS Code, Claude Desktop, and JetBrains AI Assistant. Connect to the hosted Vercel MCP endpoint or run the stdio server locally.

**Landing page:** [mcp-cloud-deploy-demo.pages.dev](https://mcp-cloud-deploy-demo.pages.dev/) · **Developer Docs:** [Hosted and local setup](public/developer/index.html) · **Privacy:** [PRIVACY.md](PRIVACY.md)

## Choose a connection

| Mode | Source files | Authentication |
| --- | --- | --- |
| Hosted Streamable HTTP | Public GitHub repo with static build output already committed | OAuth per user; Cloudflare credentials are entered on HTTPS consent page and encrypted before storage |
| Local stdio | Local `./dist`, private repositories, build output on your machine | Cloudflare credentials in local ignored `.env` |

The service deploys static output, not a Node server or server-side rendered application. A `pages.dev` URL works without owning a domain. Domains are attached only after they are registered.

## Hosted Vercel deployment

The hosted app is a Next.js Node runtime using Vercel's `mcp-handler`, OAuth authorization code + PKCE, and Upstash Redis for grants and token rotation.

1. Import `hoangtrietdev/cloudflare-mcp` as a new project in Vercel. Use the project root and Node.js 22.
2. Add Upstash Redis from Vercel Marketplace and connect it to the project. The hosted server accepts either `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or the Marketplace names `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
3. Create a 32-byte encryption key: `openssl rand -base64 32`. Set it as the Vercel **Production** environment variable `MCP_CREDENTIALS_ENCRYPTION_KEY`, then redeploy.
4. Wait for the production build to complete. The MCP endpoint is `https://<your-project>.vercel.app/api/mcp`.
5. Put that endpoint into the landing page's `endpoint` constant before publishing its updated version. MCP clients use OAuth discovery and will open the Cloudflare consent page.

Each user supplies their own Cloudflare Account ID and scoped API Token during OAuth. The hosted app encrypts those credentials with AES-256-GCM before writing them to Redis. **Do not copy the maintainer's `.env` Cloudflare token to GitHub or Vercel** for this per-user authorization flow; it is neither needed nor used by the hosted server. The local stdio server still uses `.env`.

Vercel's Git integration builds and deploys each commit to the connected branch. The GitHub Actions CI checks Node.js compatibility and builds the web app; it does not need Cloudflare deployment credentials.

## Connect an MCP client

Use the full `/api/mcp` URL. Codex, VS Code, and JetBrains accept Streamable HTTP configurations. Claude Desktop remote connectors are configured from **Settings → Connectors**. Select OAuth when prompted and enter a dedicated Cloudflare token. Grant Account → Cloudflare Pages → Edit to deploy. Add Zone → Zone → Read and Zone → DNS → Edit only if you want automatic DNS changes; scope those permissions to the relevant zones.

## Local install (stdio)

Requirements: Node.js 18+, a Cloudflare account, and a scoped Cloudflare API Token.

```bash
git clone https://github.com/hoangtrietdev/cloudflare-mcp.git
cd cloudflare-mcp
npm ci
cp .env.example .env
```

Put credentials in `.env`:

```dotenv
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
```

Build with `npm run build`. Configuration samples for Codex, VS Code, Claude Desktop, and JetBrains are in [`examples/configs/`](examples/configs/). They launch `scripts/start-local.mjs`, which loads `.env` and starts the MCP stdio server. Never put secrets in committed client config files.

The local `deploy_to_cloudflare_pages` tool accepts `dir_path` such as `./dist`, `./build`, or `./out`; the folder must contain `index.html`. Nested images, fonts, CSS, and JavaScript are uploaded with the right paths. Set `spa_mode: true` for a React/Vite single-page app that uses client-side routing.

## Hosted tools

### `deploy_to_cloudflare_pages`

Creates a Pages project if needed and uploads a static build. Hosted mode accepts `project_name`, `repo_url`, `branch`, `output_dir`, and `spa_mode`. The repository must be public and already contain the built output. The server never executes repository code or build scripts.

### `attach_custom_domain`

Adds an owned domain to a Pages project. It creates a proxied CNAME only when the DNS zone is in the authorized Cloudflare account and no conflicting record exists. Otherwise it returns the CNAME details for the current DNS provider. DNS and certificate propagation may take time.

### `list_deployments`

Returns recent deployment status, URLs, and custom-domain bindings.

Hosted source limits: 20 MiB compressed archive, 50 MiB extracted output, 10 MiB per file, and 20,000 build files. Use local stdio for private repositories, local builds, and larger assets.

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run build:vercel
```

CI validates the local MCP package on Node.js 18, 20, and 22 and builds the Vercel app on Node.js 22. Vercel production deployment is handled by the project’s Git integration.

## Security and support

- `.env`, OAuth keys, Cloudflare tokens, and Redis credentials must never be committed.
- Local MCP diagnostics go to stderr so stdout remains MCP JSON-RPC only.
- Report security issues privately as described in [SECURITY.md](SECURITY.md); do not include credentials in issues.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

MIT. See [LICENSE](LICENSE).
