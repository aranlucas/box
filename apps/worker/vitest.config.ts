import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node (WebCrypto + fetch available); no Workers runtime needed.
export default defineConfig({
  // The build-time constants from vite.config.ts, at their production values.
  define: { __BX_OIDC_ISSUER__: '""', __BX_DEV__: 'false' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
