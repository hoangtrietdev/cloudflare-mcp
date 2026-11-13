# Changelog

## Unreleased

- Verify both Cloudflare user-owned API tokens and `cfat_` account-owned API tokens during hosted OAuth authorization.
- Consume OAuth refresh tokens atomically to prevent replay races.
- Reject credentials and private-key files in local deployment folders; skip common repository and build metadata directories and cap local output size.
- Raise the supported Node.js baseline to 22 and harden CI/release workflows with immutable action refs, least-privilege permissions, timeouts, package checks, and release-tag validation.

Notable changes to this project are documented here.

- Add static asset deployment, optional React SPA fallback, and custom-domain attachment during deploy.
- Add GitHub Actions for CI and npm release publishing.
- Add contribution, security, issue, and pull request guidance.

## 1.0.0

- Add stdio MCP server with Cloudflare Pages deploy, custom domain, and deployment listing tools.
