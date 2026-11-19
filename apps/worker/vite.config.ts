import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// The Expo web export (apps/app/dist) is served as the Worker's static assets.
// BX_PERSIST points local D1/R2 state at a throwaway directory (used by test/api-check.mjs).
export default defineConfig({
  publicDir: "../app/dist",
  plugins: [cloudflare({ persistState: process.env.BX_PERSIST ? { path: process.env.BX_PERSIST } : true })],
});
