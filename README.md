# mcp-cloud-deploy

[![CI](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Deploy static websites to Cloudflare Pages from Codex, VS Code, Claude Desktop, and JetBrains AI Assistant. Choose the hosted MCP endpoint for a ready-made connection, or run the stdio server locally for local folders and private repositories.

**User setup guide:** [mcp-cloud-deploy-demo.pages.dev](https://mcp-cloud-deploy-demo.pages.dev/) · **Developer documentation:** [Developer Docs](https://mcp-cloud-deploy-demo.pages.dev/developer/) · **Privacy:** [PRIVACY.md](PRIVACY.md)

> Hosted availability: this repository includes the remote Worker implementation and a manual deployment workflow. The maintainer must deploy it and publish its real `/mcp` URL before the hosted connector is available. Until then, use local stdio mode.

## Choose how to connect

| Mode | Use it when | Source supported |
| --- | --- | --- |
| Hosted Streamable HTTP | You want to configure one remote MCP URL | Public GitHub repository that already contains static build output |
| Local stdio | Your build is on your computer, repository is private, or you need to build locally | Local static output such as `./dist` or `./build` |

Both modes provide `deploy_to_cloudflare_pages`, `attach_custom_domain`, and `list_deployments`. A Cloudflare Pages URL works without buying a domain. The tool does not purchase domains or run server-side applications.

## Hosted MCP setup (operator)

The hosted Worker uses Cloudflare OAuth. Each user enters their own Cloudflare Account ID and API Token over HTTPS on the consent page. The Worker stores OAuth connection properties in Cloudflare KV and uses the credential only for the requested Cloudflare operations. Read [PRIVACY.md](PRIVACY.md) before operating the hosted service.

1. Create a Cloudflare API token for Worker deployment with the account permissions required to deploy Workers and manage Workers KV. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions repository secrets. This is the **operator deployment token**, distinct from users' tokens.
2. Create an OAuth KV namespace: `npx wrangler kv namespace create OAUTH_KV`. Save its ID as the GitHub Actions secret `CLOUDFLARE_KV_NAMESPACE_ID`.
3. In GitHub, open **Actions → Deploy hosted MCP Worker → Run workflow**. The workflow creates a temporary Wrangler config containing the KV ID, deploys the Worker, and removes that config afterward.
4. Copy the resulting Worker URL and append `/mcp`, for example `https://mcp-cloud-deploy-server.<account-subdomain>.workers.dev/mcp`.
5. Replace the endpoint constant in `public/index.html` with this real URL and publish the website to Cloudflare Pages.

For a manual deployment, see [Developer Docs](https://mcp-cloud-deploy-demo.pages.dev/developer/#hosted). Do not commit API tokens or generated Wrangler configs.

### Connect a hosted MCP client

Use the published endpoint in your MCP client. The consent page asks for your Cloudflare Account ID and a dedicated API Token. Grant **Account → Cloudflare Pages → Edit** to deploy. Add **Zone → Zone → Read** and **Zone → DNS → Edit** only if you want automatic DNS changes. Limit these permissions to the relevant account/zones. Never use your Global API Key.

Example configs are available on the landing page and in `examples/configs/`. Claude Desktop's remote connector is added from **Settings → Connectors**. Codex, VS Code and JetBrains accept Streamable HTTP endpoint configuration.

## Local install (stdio)

Requirements: Node.js 18+, a Cloudflare account, and a scoped Cloudflare API Token.

```bash
git clone https://github.com/hoangtrietdev/cloudflare-mcp.git
cd cloudflare-mcp
npm ci
cp .env.example .env
```

Add credentials to the ignored `.env` file:

```dotenv
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
```

Build the package with `npm run build`. MCP client configuration samples are in [`examples/configs/`](examples/configs/). They launch `scripts/start-local.mjs`, which loads `.env` from the repository and starts the stdio server. Do not configure credentials in a committed client config.

The local tool accepts `dir_path` such as `./dist`, `./build`, or `./out`; the directory must contain `index.html`. All nested static assets are uploaded with content types. Set `spa_mode: true` for a React/Vite single-page app that requires client-side route fallback.

## Cloudflare Pages tools

### `deploy_to_cloudflare_pages`

Creates a Pages project when needed and deploys a static build. Local stdio accepts `project_name`, `dir_path`, `branch`, optional `spa_mode`, and optional `domain`. Hosted mode accepts `project_name`, `repo_url`, `branch`, `output_dir`, and optional `spa_mode`; its GitHub repository must be public and already contain the build output. The hosted Worker never executes repository scripts.

### `attach_custom_domain`

Attaches an owned domain to a Pages project. If its DNS zone is in the authorized Cloudflare account, the tool creates a proxied CNAME only when there is no conflicting record. Existing records are left unchanged. Otherwise, the tool returns the exact CNAME details for the current DNS provider. DNS and TLS propagation can take time.

### `list_deployments`

Returns recent deployment statuses, live URLs, and custom-domain bindings.

### Application limits

This project deploys static output, not a Node server or server-side rendered app. Hosted GitHub archive limits are 20 MiB compressed, 50 MiB extracted, 10 MiB per file, and 20,000 files. For private repositories, local builds, or larger inputs, use stdio mode.

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
npx tsc -p tsconfig.remote.json
npx wrangler deploy --config remote/wrangler.jsonc --dry-run
```

CI validates the Node.js stdio package on Node 18, 20, and 22. Worker typechecking and the Wrangler dry-run use Node 22. Production Worker deployment is a separate manual workflow and does not run automatically for pull requests.

## Security and support

- `.env`, API tokens, OAuth authorization headers, and generated deployment configs must never be committed.
- Internal local-server diagnostics go to stderr so stdout remains available for MCP JSON-RPC.
- Report vulnerabilities using [SECURITY.md](SECURITY.md); please do not publish secrets in issues.
- Read [CONTRIBUTING.md](CONTRIBUTING.md), open an issue, or submit a pull request to contribute.

## License

MIT. See [LICENSE](LICENSE).
