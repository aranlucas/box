import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    // Kept deliberately short: the hostname is printed inside every label's QR code.
    name: "bx",
    compatibilityDate: "2026-10-23",
    // global_fetch_strictly_public: fetch() to another Worker on this account's workers.dev
    // subdomain (the auth service) is otherwise blocked with error 1042.
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    observability: { enabled: true },
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
      // Any request presenting the legacy household key (caps key guessing on every route).
      KEY_LIMIT: bindings.rateLimit({ namespace: "2003", simple: { limit: 60, period: 60 } }),
    },
  },
});
