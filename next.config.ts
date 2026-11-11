const nextConfig = {
  typescript: { tsconfigPath: 'tsconfig.next.json' },
  serverExternalPackages: ['blake3-wasm'],
  webpack(config: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return config;
  }
};
export default nextConfig;
