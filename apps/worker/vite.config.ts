import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// The Expo web export (apps/app/dist) is served as the Worker's static assets.
export default defineConfig({
  publicDir: "../app/dist",
  plugins: [cloudflare()],
});
