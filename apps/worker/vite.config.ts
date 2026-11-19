import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

// The Expo web export (apps/app/dist) is served as the Worker's static assets.
// BX_PERSIST points local D1/R2 state at a throwaway directory (used by test/api-check.mjs).
export default defineConfig(({ command }) => ({
  publicDir: '../app/dist',
  define: {
    // Test-only: point OIDC at a fake issuer (test/api-check.mjs). Empty in real builds → production issuer.
    __BX_OIDC_ISSUER__: JSON.stringify(
      command === 'serve' ? (process.env.BX_OIDC_ISSUER ?? '') : '',
    ),
    // Dev-only routes (dev-login) are compiled out of production builds.
    __BX_DEV__: JSON.stringify(command === 'serve'),
  },
  plugins: [
    cloudflare({ persistState: process.env.BX_PERSIST ? { path: process.env.BX_PERSIST } : true }),
  ],
}));
