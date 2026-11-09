# mcp-cloud-deploy

[![CI](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hoangtrietdev/cloudflare-mcp/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Repository: [hoangtrietdev/cloudflare-mcp](https://github.com/hoangtrietdev/cloudflare-mcp) · npm package name: `mcp-cloud-deploy` (first release pending).

A local-first [Model Context Protocol](https://modelcontextprotocol.io/) server that deploys built websites to Cloudflare Pages. Ask your MCP host to publish a static site, a React single-page app, or attach a domain you already own.

> Your site files are read on your machine and sent directly to Cloudflare Pages. This server does not proxy or store your project files.

## Features

- Direct upload of static build directories, including nested images, fonts, JavaScript, and CSS.
- Cloudflare Pages project creation when the requested project does not exist.
- Optional React/Vite single-page application fallback for client-side routes.
- Optional custom-domain binding and CNAME creation for zones in your Cloudflare account.
- Actionable DNS instructions when the domain is hosted elsewhere.
- Recent deployment and domain status reporting.
- Stdio transport for Claude Desktop, Cursor, and other MCP clients.
- Secrets loaded locally from environment variables or `.env`; diagnostics go to stderr.

## Requirements

- Node.js 18 or newer.
- A Cloudflare account.
- A Cloudflare API token with **Pages Write**. For automatic DNS changes, also grant **Zone:Read** and **DNS:Edit** for the relevant zones.
- The Cloudflare account ID that owns your Pages project and DNS zones.

Use a narrowly scoped token. Never commit `.env` or paste a token into an issue. See [Security](SECURITY.md) for reporting vulnerabilities.

## Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env` locally:

```dotenv
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
```

Then build:

```bash
npm run build
```

The `.env` file is ignored by Git. The process environment takes precedence over `.env` values.

## Connect an MCP host

### Claude Desktop

Add this server to Claude Desktop's MCP configuration. Replace the script path with the absolute path to this checkout. Put credentials in `env` or use the local `.env` file when the host starts the process with this project directory as its working directory.

```json
{
  "mcpServers": {
    "mcp-cloud-deploy": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-cloud-deploy/dist/index.js"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "your_cloudflare_api_token",
        "CLOUDFLARE_ACCOUNT_ID": "your_cloudflare_account_id"
      }
    }
  }
}
```

An equivalent example is in [`claude_desktop_config.json`](claude_desktop_config.json). Restart Claude Desktop after changing its MCP configuration.

### Cursor

Add the built server to Cursor's MCP configuration:

```json
{
  "mcpServers": {
    "mcp-cloud-deploy": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-cloud-deploy/dist/index.js"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "your_cloudflare_api_token",
        "CLOUDFLARE_ACCOUNT_ID": "your_cloudflare_account_id"
      }
    }
  }
}
```

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
