# mcp-cloud-deploy

[![CI](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Repository: [hoangtrietdev/cloudflare-mcp](https://github.com/hoangtrietdev/cloudflare-mcp) · npm package name: `mcp-cloud-deploy` (first release pending).

**Live demo:** [mcp-cloud-deploy-demo.pages.dev](https://mcp-cloud-deploy-demo.pages.dev) · **Quick setup:** [Install and configure](#install-and-configure).

A local-first [Model Context Protocol](https://modelcontextprotocol.io/) server that deploys built websites to Cloudflare Pages. Ask your MCP host to publish a static site, a React single-page app, or attach a domain you already own.

> Your site files are read on your machine and sent directly to Cloudflare Pages. This server does not proxy or store your project files.

## Features

- Direct upload of static build directories, including nested images, fonts, JavaScript, and CSS.
- Cloudflare Pages project creation when the requested project does not exist.
- Optional React/Vite single-page application fallback for client-side routes.
- Optional custom-domain binding and CNAME creation for zones in your Cloudflare account.
- Actionable DNS instructions when the domain is hosted elsewhere.
- Recent deployment and domain status reporting.
- Stdio transport with setup examples for Codex, VS Code, Claude Desktop, and JetBrains AI Assistant.
- Secrets loaded locally from environment variables or `.env`; diagnostics go to stderr.

## Requirements

- Node.js 18 or newer.
- A Cloudflare account.
- A Cloudflare API token with **Pages Write**. For automatic DNS changes, also grant **Zone:Read** and **DNS:Edit** for the relevant zones.
- The Cloudflare account ID that owns your Pages project and DNS zones.

Use a narrowly scoped token. Never commit `.env` or paste a token into an issue. See [Security](SECURITY.md) for reporting vulnerabilities.

## Install and configure

Clone and build the server locally:

```bash
git clone https://github.com/hoangtrietdev/cloudflare-mcp.git
cd cloudflare-mcp
npm ci
cp .env.example .env
```

Add your credentials to `.env`:

```dotenv
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
```

Then build the local server:

```bash
npm run build
```

The local launcher changes into the repository before starting the server, so `dotenv` finds this `.env` regardless of which app launched the process. `.env` is ignored by Git. Never add credentials to a committed config or issue.

## Connect an MCP host

All four clients can run the same local stdio server. Replace `/absolute/path/to/cloudflare-mcp` in a sample with the path where you cloned this repository. The configuration examples are in [`examples/configs/`](examples/configs/).

### OpenAI Codex

Add the contents of [`examples/configs/codex.toml`](examples/configs/codex.toml) to `~/.codex/config.toml`. Restart Codex or reload its MCP servers. The config points to `scripts/start-local.mjs`, which loads the repository's local `.env`.

### Visual Studio Code

Create `.vscode/mcp.json` in your workspace using [`examples/configs/vscode.mcp.json`](examples/configs/vscode.mcp.json). In VS Code, run **MCP: List Servers** from the Command Palette to start or inspect the server. The file uses VS Code's `servers` format and `envFile` support.

### Claude Desktop

Merge [`examples/configs/claude_desktop.json`](examples/configs/claude_desktop.json) into Claude Desktop's `claude_desktop_config.json`. Common locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `$XDG_CONFIG_HOME/Claude/claude_desktop_config.json` or `~/.config/Claude/claude_desktop_config.json`

Restart Claude Desktop after saving.

### JetBrains AI Assistant

Open **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, add an MCP server, and paste [`examples/configs/jetbrains.json`](examples/configs/jetbrains.json). Set the working directory to your repository root if the IDE asks for it, then apply and enable the server. JetBrains can also import the same server from the Claude Desktop config.

> JetBrains AI Assistant can connect to this deployment server as an MCP client. JetBrains IDEs can separately expose their own IDE context through a built-in MCP server; that is a different direction of connection.

## Tools

### `deploy_to_cloudflare_pages`

Deploys a local build directory containing `index.html`. It walks nested folders and uploads files with their content types, so image-heavy landing pages and static build output are supported.

Inputs:

- `project_name` (required): Cloudflare Pages project name, lowercase letters, numbers, and hyphens. For a request like “deploy my website named mystoreabc,” use `mystoreabc`.
- `dir_path` (required): Build output path, such as `./dist`, `./build`, or `./out`.
- `branch` (optional): Deployment branch; defaults to `main`.
- `spa_mode` (optional): Set `true` for React/Vite apps that use client-side history routes. This adds the Pages fallback `/* /index.html 200`. Leave it off for traditional multi-page sites.
- `domain` (optional): A domain you already own, such as `www.example.com`. It is attached after the deployment. Omit it if you do not have a domain; the tool returns a Pages deployment URL you can use immediately.

Examples of the intended conversation:

> “Deploy my website named mystoreabc from `./dist`. I don't have a domain.”

The host should deploy the files and give you the generated `pages.dev` URL. You do not need to buy a domain first.

> “Deploy my React app named mystoreabc from `./dist`, enable SPA routing, and attach `www.example.com`.”

The host should set `spa_mode: true`, deploy, then bind the domain and report DNS and SSL status. If your DNS zone is outside this Cloudflare account, the tool gives the CNAME target to add at that provider.

### `attach_custom_domain`

Adds a custom domain to an existing Pages project. If the matching DNS zone is in this Cloudflare account, the tool creates a proxied CNAME only when there is no conflicting record. Existing DNS records are not overwritten. If the zone is hosted externally, it returns the record to create there.

### `list_deployments`

Lists recent deployment URLs and statuses alongside configured custom domains.

## Site compatibility

- **Static landing pages:** Point `dir_path` at the built output. Keep images and other assets under that directory so their relative paths are preserved.
- **React/Vite SPA:** Point at the generated build directory, usually `dist`, and set `spa_mode: true` when the app uses client-side history routing.
- **Server-rendered or server-dependent apps:** This tool deploys static output only. Build/export a static version first; it does not deploy a Node.js server or server-side rendering runtime.
- **Large builds:** Cloudflare Pages limits individual asset size and total file count. The tool returns a clear error when an individual file exceeds 25 MiB or the manifest exceeds 20,000 files.

## Custom domains and DNS

A custom domain is optional. Without one, use the `pages.dev` deployment URL. The server cannot register or purchase a domain for you.

When you provide a domain, the server:

1. Adds the hostname to the Pages project.
2. Finds the longest matching DNS zone in the configured Cloudflare account.
3. Creates a proxied CNAME to `<project-name>.pages.dev` if there is no conflicting record.
4. Reports the Pages binding and certificate status.

If DNS is hosted outside this account, add the CNAME shown by the tool at your DNS provider. DNS propagation and certificate issuance may take time. Existing conflicting records are left untouched and reported for manual review.

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
npm audit --omit=dev
```

The test suite uses Node's built-in test runner. The GitHub Actions CI workflow runs build, type checking, tests, and a production dependency audit on Node.js 18, 20, and 22.

## Troubleshooting

- **Missing credentials:** Confirm `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are available to the server process.
- **401/403 from Cloudflare:** Check token expiry and Pages/DNS permissions.
- **Build directory error:** Build the app first and pass the output directory, not the source folder. It must contain `index.html`.
- **Deep links return 404 in a React app:** Set `spa_mode: true` and redeploy.
- **Custom domain does not resolve:** Check the reported DNS record at the authoritative DNS provider, then allow time for propagation and TLS certificate issuance.
- **Tool output is missing or garbled:** MCP uses stdout for JSON-RPC; this server sends diagnostics to stderr. Do not add `console.log` calls to the server process.

## Contributing

Bug reports, fixes, and feature proposals are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), use the issue templates, and submit changes through a pull request.

## License

MIT. See [LICENSE](LICENSE).
