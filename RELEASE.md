# Release process

Releases are published to npm when a GitHub Release is published.

## Repository setup

Before the first release:

1. Replace `OWNER/REPO` placeholders in `package.json`, the README badges, and issue-template contact links.
2. Create the npm package and configure npm Trusted Publishing for this GitHub repository and `.github/workflows/release.yml`.
3. Confirm the npm package name is available and that the publisher configuration grants the workflow publish access.
4. Ensure CI passes on the release commit.

No long-lived npm token is stored in GitHub Actions; the workflow requests a short-lived OIDC token for provenance publishing.

## Publish

1. Update `version` in `package.json` and `package-lock.json` using semantic versioning.
2. Move the corresponding notes from `Unreleased` in `CHANGELOG.md` into a versioned section.
3. Open and merge a pull request; wait for CI.
4. Create a GitHub Release with a matching `vX.Y.Z` tag.
5. The release workflow builds, tests, and publishes the package to npm with provenance.
