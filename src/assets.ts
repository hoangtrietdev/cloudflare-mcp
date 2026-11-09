const SPA_FALLBACK = '/* /index.html 200';

/** Add Cloudflare Pages history-route fallback while preserving custom rules. */
export function withSpaFallback(redirects: string | undefined): string {
  const existing = (redirects ?? '').replace(/\s*$/, '');
  const alreadyConfigured = existing
    .split(/\r?\n/)
    .some((line) => /^\/\*\s+\/index\.html\s+200(?:\s|$)/.test(line.trim()));

  if (alreadyConfigured) return `${existing}\n`;
  return `${existing}${existing ? '\n' : ''}${SPA_FALLBACK}\n`;
}


/** Build the path-to-content-hash manifest required by Cloudflare Pages. */
export function createPagesManifest(entries: Iterable<{ relative: string; hash: string }>): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const entry of entries) manifest[`/${entry.relative.replaceAll('\\', '/')}`] = entry.hash;
  return manifest;
}
