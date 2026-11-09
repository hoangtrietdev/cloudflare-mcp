import test from 'node:test';
import assert from 'node:assert/strict';
import { domainSchema, projectNameSchema } from '../dist/validation.js';

test('accepts Cloudflare Pages project names', () => {
  assert.equal(projectNameSchema.parse('mystoreabc'), 'mystoreabc');
  assert.equal(projectNameSchema.parse('my-store-42'), 'my-store-42');
});

test('rejects project names Cloudflare cannot use', () => {
  for (const name of ['MyStore', '-store', 'store-', 'store_name', '']) {
    assert.equal(projectNameSchema.safeParse(name).success, false, name);
  }
});

test('accepts fully qualified custom domains', () => {
  assert.equal(domainSchema.parse('www.example.com'), 'www.example.com');
  assert.equal(domainSchema.parse('shop.example.co.uk'), 'shop.example.co.uk');
});

test('rejects malformed custom domains', () => {
  for (const domain of ['localhost', 'https://example.com', '-bad.example.com', 'example']) {
    assert.equal(domainSchema.safeParse(domain).success, false, domain);
  }
});

test('adds an SPA route fallback without discarding custom redirects', async () => {
  const { withSpaFallback } = await import('../dist/assets.js');
  assert.equal(withSpaFallback(undefined), '/* /index.html 200\n');
  assert.equal(withSpaFallback('/old /new 301\n'), '/old /new 301\n/* /index.html 200\n');
  assert.equal(withSpaFallback('/* /index.html 200'), '/* /index.html 200\n');
});

test('creates slash-prefixed Pages manifest paths mapped to hashes', async () => {
  const { createPagesManifest } = await import('../dist/assets.js');
  assert.deepEqual(createPagesManifest([
    { relative: 'index.html', hash: 'html-hash' },
    { relative: 'images/hero.svg', hash: 'image-hash' },
  ]), {
    '/index.html': 'html-hash',
    '/images/hero.svg': 'image-hash',
  });
});
