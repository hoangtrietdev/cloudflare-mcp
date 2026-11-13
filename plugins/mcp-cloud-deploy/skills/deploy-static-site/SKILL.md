---
name: deploy-static-site
description: Deploy a static website or single-page app to Cloudflare Pages with the MCP Cloud Deploy tools, optionally attach a custom domain, and report the live URL. Use when the user asks to deploy, publish, host or put a site online on Cloudflare Pages or pages.dev.
---

# Deploy a static site to Cloudflare Pages

Use the `mcp-cloud-deploy` tools: `deploy_to_cloudflare_pages`, `attach_custom_domain`, `list_deployments`.

## 1. Gather inputs

- **project_name**: lowercase letters, digits and hyphens. It becomes `<project_name>.pages.dev`. Suggest one from the site name if the user gives none.
- **repo_url**: a public GitHub repository. The hosted server does not build code, so the built output must already be committed.
- **branch**: default `main` unless the user says otherwise.
- **output_dir**: the folder holding `index.html`, usually `dist`, `build` or `out`.
- **spa_mode**: `true` for React, Vite, Vue or Svelte apps with client-side routing; `false` for plain multi-page static sites.

If the repository is private or the output is only on the user's machine, explain that the hosted connector cannot reach it and point them to the local stdio setup in the project README.

## 2. Deploy

Call `deploy_to_cloudflare_pages`. Report the `pages.dev` URL and the deployment status. If it fails, relay the error and the likely fix (missing `index.html`, wrong `output_dir`, private repo, size limits, or a token without Pages Edit).

## 3. Custom domain (only if the user owns one)

Confirm the exact domain with the user before calling `attach_custom_domain`, because it changes DNS. If the tool returns a CNAME record instead of creating one, give the user the record to add at their DNS provider and mention that SSL can take some time to issue.

## 4. Check status

Use `list_deployments` when the user asks what is live or wants to confirm a deployment finished.
