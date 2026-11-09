# Security policy

## Supported versions

Security fixes are applied to the latest published version. Upgrade to the latest release before reporting an issue.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** feature in the Security tab to send a private advisory to the maintainers. Include affected versions, impact, and steps to reproduce. Do not include live API tokens or customer site data.

We will acknowledge reports as soon as practical and coordinate a fix and disclosure with the reporter.

## Secret handling

- Credentials are read locally from process environment or `.env`.
- `.env` is excluded from version control and the npm package.
- Never include credentials in tool arguments, issue reports, screenshots, or logs.
- Use a dedicated, least-privilege Cloudflare API token and revoke it if it is exposed.
