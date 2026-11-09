# Contributing

Thanks for helping improve `mcp-cloud-deploy`.

## Before opening a change

- Search existing issues and pull requests for related work.
- For a bug, provide a minimal reproduction and sanitized output. Never include API tokens, account IDs, or private site files.
- For a feature, describe the user workflow and expected tool behavior in an issue first when the change is substantial.

## Local development

Requirements: Node.js 18+ and npm.

```bash
npm ci
npm run build
npm run typecheck
npm test
npm audit --omit=dev
```

Do not run real Cloudflare deployments from CI. Any manual integration check must use a test Pages project and must not expose credentials in logs.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Add or update tests for logic changes.
- Update README or configuration examples when tool inputs or behavior change.
- Keep generated output, `.env`, API credentials, and personal project content out of commits.
- Ensure CI passes before requesting review.

By contributing, you agree that your contributions are provided under the repository's MIT license.
