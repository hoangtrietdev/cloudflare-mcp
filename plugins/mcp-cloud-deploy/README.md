# MCP Cloud Deploy

Deploy static websites and single-page apps to Cloudflare Pages straight from Claude or Codex. This plugin connects your assistant to the hosted MCP Cloud Deploy server and adds a skill that walks the assistant through a safe deployment.

## What it connects to

The plugin adds one remote MCP server over HTTPS: `https://cloudflare-mcp-rho.vercel.app/api/mcp`. It runs no local commands and installs no packages.

When you first use it, your client opens an OAuth consent page on that server. There you enter your own Cloudflare Account ID and a scoped Cloudflare API token:

- **Account → Cloudflare Pages → Edit** (required to deploy)
- **Zone → Zone → Read** and **Zone → DNS → Edit** (only if you want DNS records created automatically)

## Tools

| Tool | What it does |
| --- | --- |
| `deploy_to_cloudflare_pages` | Downloads prebuilt output from a public GitHub repository (`api.github.com`, `codeload.github.com`) and uploads it to a Cloudflare Pages project, creating the project if needed. Supports SPA fallback. |
| `attach_custom_domain` | Adds a domain you own to a Pages project and creates a proxied CNAME when the DNS zone is in your Cloudflare account and no conflicting record exists. |
| `list_deployments` | Read-only list of recent deployments, URLs and custom-domain bindings. |

The hosted server never runs repository code or build scripts. Commit the built output (for example `dist/`) to a public repository first. Limits: 20 MiB compressed archive, 50 MiB extracted, 10 MiB per file, 20,000 files.

## Data and privacy

The server sends data only to GitHub (to fetch the public archive) and Cloudflare (to perform the deployment and DNS changes you ask for). Cloudflare credentials are encrypted with AES-256-GCM before they are stored in Upstash Redis and are never included in tool responses or logs. See the [privacy policy](https://cloudflare-mcp-rho.vercel.app/privacy) and [terms](https://cloudflare-mcp-rho.vercel.app/terms).

## Support

Report issues at https://github.com/hoangtrietdev/cloudflare-mcp/issues. Source code: https://github.com/hoangtrietdev/cloudflare-mcp (MIT).
