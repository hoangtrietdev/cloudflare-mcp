# Example requests

Use these prompts in Codex, VS Code, Claude Desktop, JetBrains AI Assistant, or another connected MCP host. The host should ask for the build directory if you have not provided one. Host setup examples are in [`configs/`](configs/).

## Image-heavy static landing page, no domain

> Deploy my website as `mystoreabc` from `./dist`. It is a static landing page with images in nested folders, and I do not have a domain.

Expected behavior: deploy all regular files under `./dist`, preserve nested asset paths, and return a working `pages.dev` deployment URL. No custom domain is needed.

## React app with deep links

> Deploy my React app as `mystoreabc` from `./dist`. It uses client-side routes, so enable SPA mode. I don't have a domain yet.

Expected behavior: deploy the build output and configure the Pages fallback so direct navigation to a client-side route returns `index.html`.

## Existing domain

> Deploy my website as `mystoreabc` from `./dist` and attach `www.example.com`.

Expected behavior: deploy first, then bind the provided domain. If its zone belongs to the configured Cloudflare account, create a CNAME only when there is no conflicting record. Otherwise return the exact CNAME instructions to apply at the current DNS provider.
