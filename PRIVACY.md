# Privacy policy

`mcp-cloud-deploy` is an open-source tool. This policy describes the hosted MCP Worker when operated by the project maintainer; self-hosters operate their own instance and control its data.

## Data the hosted service handles

- OAuth connection metadata needed to connect an MCP client.
- The Cloudflare Account ID and API Token that you submit on the HTTPS consent page.
- GitHub public repository URLs, selected branches and deployment requests sent to its tools.

The OAuth provider stores authorization grants and connection properties in Cloudflare Workers KV. Cloudflare's OAuth provider encrypts stored props; the Worker uses your token to call Cloudflare APIs. Tokens are not included in tool responses or application logs. The service does not request or store website source archives after a request completes. Cloudflare Pages receives the deployed files.

## Use and disclosure

Credentials are used only to validate your Cloudflare access and perform the requested Pages, DNS, and deployment-status operations. They are not sold or shared with analytics or advertising services. The Worker fetches hosted build assets only from public GitHub archives (`api.github.com` and `codeload.github.com`).

## Retention and revocation

OAuth grants remain in the configured Cloudflare KV namespace until revoked or removed by the operator. Disconnect/revoke the MCP authorization to remove the grant. Also revoke the API Token in the Cloudflare dashboard to invalidate the underlying credential immediately. Deployments and DNS changes remain in your Cloudflare account under Cloudflare's own retention policies.

## Security and contact

Use a dedicated API Token with the minimum required account and zone permissions. Do not use a Global API Key. The project maintainer cannot see your token in MCP tool outputs, but the hosted Worker must process it to provide the service. Do not connect if you do not trust the operator. Report security issues privately as described in [SECURITY.md](SECURITY.md).

For a self-hosted installation, review the source and configure your own Worker, KV namespace, and privacy notice.
