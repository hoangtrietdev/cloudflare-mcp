# Release process

The package name is `mcp-cloud-deploy`. The first version has not been published to npm yet. The repository is [hoangtrietdev/cloudflare-mcp](https://github.com/hoangtrietdev/cloudflare-mcp), and the package name currently has no published version.

## One-time npm setup

npm requires a package to exist before a Trusted Publisher can be configured. Bootstrap the first release from a maintainer workstation:

1. Confirm the public GitHub repository and package metadata are correct.
2. From this checkout, run `npm publish --access public` while signed in to the npm account that will own the package. npm may require account 2FA. This first publication creates the package; do not put an npm token in the repository or GitHub Actions.
3. In npm package settings, configure a GitHub Actions Trusted Publisher with:
   - GitHub user or organization: `hoangtrietdev`
   - Repository: `cloudflare-mcp`
   - Workflow file: `release.yml`
   - Allow direct `npm publish`
4. Complete the first successful trusted publish within two days of creating the npm publisher configuration, or npm expires that configuration.

After the package exists and the publisher is configured, the workflow uses OIDC and does not require a long-lived npm token. Public GitHub visibility is required for npm provenance.

## Publish subsequent versions

1. Update `version` in `package.json` and `package-lock.json` using semantic versioning.
2. Move the corresponding notes from `Unreleased` in `CHANGELOG.md` into a versioned section.
3. Open and merge a pull request; wait for CI.
4. Create a GitHub Release with a matching `vX.Y.Z` tag.
5. The release workflow builds, tests, and publishes the package to npm with provenance.
