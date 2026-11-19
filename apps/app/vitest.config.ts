import { defineConfig } from 'vitest/config';

// Pure-logic tests only (no React Native runtime).
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
