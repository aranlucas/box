import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    // Kept deliberately short: the hostname is printed inside every label's QR code.
    name: "bx",
    compatibilityDate: "2026-10-23",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*", "/B/*", "/auth/*"],
    },
    env: {
      DB: bindings.d1({ id: "52c32efc-6ee3-48d8-8b4e-f41ad071a511", name: "moving-boxes" }),
      PHOTOS: bindings.r2({ name: "moving-box-photos" }),
      OPENAI_MODEL: bindings.text("gpt-5.1"),
      OPENAI_API_KEY: bindings.secret(),
      HOUSEHOLD_KEY: bindings.secret(),
      AUTH_CLIENT_ID: bindings.secret(),
      AUTH_CLIENT_SECRET: bindings.secret(),
      // Per-IP throttles: household-key claims / invite accepts, and sign-in starts.
      SENSITIVE_LIMIT: bindings.rateLimit({ namespace: "2001", simple: { limit: 5, period: 60 } }),
      LOGIN_LIMIT: bindings.rateLimit({ namespace: "2002", simple: { limit: 20, period: 60 } }),
    },
  },
});
