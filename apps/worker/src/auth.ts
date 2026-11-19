import { env } from "cloudflare:workers";
import type { Context, Next } from "hono";

export async function requireKey(c: Context, next: Next) {
  const key = c.req.header("x-household-key");
  if (!key || key !== env.HOUSEHOLD_KEY) return c.json({ error: "Household key required" }, 401);
  await next();
}
