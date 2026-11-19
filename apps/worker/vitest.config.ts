import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node (WebCrypto + fetch available); no Workers runtime needed.
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
