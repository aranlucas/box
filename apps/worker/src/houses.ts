import { env } from "cloudflare:workers";
import { Hono, type Context } from "hono";
import { userFromRequest, type User } from "./auth/session.ts";
import { allow, randomToken, safeEqual, sha256Hex } from "./util.ts";

export const HOME_ID = "HOME0000";
export const PUBLIC_ORIGIN = "https://bx.aranlucas.workers.dev";
const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;

type Role = "owner" | "member";
export type Actor = { user: User | null; legacy: boolean };

async function homeUnclaimed(): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS x FROM members WHERE house_id = ? AND role = 'owner' LIMIT 1")
    .bind(HOME_ID)
    .first();
  return !row;
}

export async function roleIn(userId: string, houseId: string): Promise<Role | null> {
  const row = await env.DB.prepare("SELECT role FROM members WHERE house_id = ? AND user_id = ?")
    .bind(houseId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

/**
 * Who is calling: a signed-in user, and/or a legacy household-key holder. The legacy key only
 * counts while Home has no owner, so claiming Home switches it off.
 */
export async function actorFrom(c: Context): Promise<Actor> {
  const user = await userFromRequest(c);
  const key = c.req.header("x-household-key");
  const legacy = !!key && !!env.HOUSEHOLD_KEY && (await safeEqual(key, env.HOUSEHOLD_KEY)) && (await homeUnclaimed());
  return { user, legacy };
}

export async function canAccessHouse(actor: Actor, houseId: string): Promise<boolean> {
  if (actor.user && (await roleIn(actor.user.id, houseId))) return true;
  return actor.legacy && houseId === HOME_ID;
}

const needUser = (c: Context, user: User | null) => (user ? null : c.json({ error: "Sign in required" }, 401));

export const houseRoutes = new Hono();

houseRoutes.get("/me", async (c) => {
  const user = await userFromRequest(c);
  const claimable = await homeUnclaimed();
  if (!user) return c.json({ user: null, houses: [], legacyHomeClaimable: claimable });
  const { results } = await env.DB.prepare(
    `SELECT h.id, h.name, m.role FROM members m JOIN houses h ON h.id = m.house_id
     WHERE m.user_id = ? ORDER BY m.created_at`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; role: Role }>();
  return c.json({ user, houses: results, legacyHomeClaimable: claimable });
});

// Only existing owners may create more houses: a stranger who signs in can't spend AI budget.
houseRoutes.post("/houses", async (c) => {
  const user = await userFromRequest(c);
  const denied = needUser(c, user);
  if (denied) return denied;
  const name = ((await c.req.json<{ name?: string }>().catch(() => ({}))) as { name?: string }).name?.trim();
  if (!name) return c.json({ error: "Name required" }, 400);
  const owns = await env.DB.prepare("SELECT 1 AS x FROM members WHERE user_id = ? AND role = 'owner' LIMIT 1")
    .bind(user!.id)
    .first();
  if (!owns) return c.json({ error: "Ask a household member for an invite" }, 403);
  const id = randomToken(9);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO houses (id, name, created_at) VALUES (?, ?, ?)").bind(id, name.slice(0, 60), now),
    env.DB.prepare("INSERT INTO members (house_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, user!.id, now),
  ]);
  return c.json({ house: { id, name: name.slice(0, 60), role: "owner" } });
});

houseRoutes.post("/houses/:id/claim", async (c) => {
  if (c.req.param("id") !== HOME_ID) return c.json({ error: "Not found" }, 404);
  const user = await userFromRequest(c);
  const denied = needUser(c, user);
  if (denied) return denied;
  if (!(await allow(env.SENSITIVE_LIMIT, "claim", c.req.header("cf-connecting-ip")))) {
    return c.json({ error: "Too many attempts. Try again in a minute." }, 429);
  }
  const { key } = (await c.req.json<{ key?: string }>().catch(() => ({}))) as { key?: string };
  if (!key || !env.HOUSEHOLD_KEY || !(await safeEqual(key.trim(), env.HOUSEHOLD_KEY))) return c.json({ error: "Wrong key" }, 403);
  const now = Date.now();
  // Single statement so two simultaneous claims can't both win.
  const res = await env.DB.prepare(
    `INSERT INTO members (house_id, user_id, role, created_at)
     SELECT ?1, ?2, 'owner', ?3 WHERE NOT EXISTS (SELECT 1 FROM members WHERE house_id = ?1 AND role = 'owner')
     ON CONFLICT (house_id, user_id) DO UPDATE SET role = 'owner'`,
  )
    .bind(HOME_ID, user!.id, now)
    .run();
  if (!res.meta.changes) return c.json({ error: "Home has already been claimed" }, 409);
  return c.json({ house: { id: HOME_ID, name: "Home", role: "owner" } });
});

houseRoutes.get("/houses/:id/members", async (c) => {
  const user = await userFromRequest(c);
  const denied = needUser(c, user);
  if (denied) return denied;
  const houseId = c.req.param("id");
  const role = await roleIn(user!.id, houseId);
  if (!role) return c.json({ error: "Not a member of this house" }, 403);
  const members = await env.DB.prepare(
    `SELECT m.user_id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.house_id = ? ORDER BY m.role = 'owner' DESC, m.created_at`,
  )
    .bind(houseId)
    .all();
  const invites =
    role === "owner"
      ? (
          await env.DB.prepare(
            `SELECT substr(token_hash, 1, 12) AS id, created_at, expires_at FROM invites
             WHERE house_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
             ORDER BY created_at DESC`,
          )
            .bind(houseId, Date.now())
            .all()
        ).results
      : [];
  return c.json({ members: members.results, invites });
});

houseRoutes.delete("/houses/:id/members/:userId", async (c) => {
  const user = await userFromRequest(c);
  const denied = needUser(c, user);
  if (denied) return denied;
  const houseId = c.req.param("id");
  const target = c.req.param("userId");
  const role = await roleIn(user!.id, houseId);
  // Owners can remove anyone; members can remove themselves (leave).
  if (role !== "owner" && target !== user!.id) return c.json({ error: "Only owners can remove members" }, 403);
  const targetRole = await roleIn(target, houseId);
  if (!targetRole) return c.json({ error: "Not a member" }, 404);
  if (targetRole === "owner") {
    const owners = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE house_id = ? AND role = 'owner'")
      .bind(houseId)
      .first<{ n: number }>();
    if ((owners?.n ?? 0) <= 1) return c.json({ error: "A house needs at least one owner" }, 400);
  }
  await env.DB.prepare("DELETE FROM members WHERE house_id = ? AND user_id = ?").bind(houseId, target).run();
  return c.json({ ok: true });
});

houseRoutes.post("/houses/:id/invites", async (c) => {
  const user = await userFromRequest(c);
  const denied = needUser(c, user);
  if (denied) return denied;
  const houseId = c.req.param("id");
  if ((await roleIn(user!.id, houseId)) !== "owner") return c.json({ error: "Only owners can invite" }, 403);
  const token = randomToken(24);
  const now = Date.now();
  const expiresAt = now + INVITE_TTL;
  await env.DB.prepare("INSERT INTO invites (token_hash, house_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), houseId, user!.id, now, expiresAt)
    .run();
  return c.json({ url: `${PUBLIC_ORIGIN}/invite/${token}`, expires_at: expiresAt });
});

houseRoutes.delete("/houses/:id/invites/:inviteId", async (c) => {
  const user = await userFromRequest(c);
  const denied = needUser(c, user);
  if (denied) return denied;
  const houseId = c.req.param("id");
  if ((await roleIn(user!.id, houseId)) !== "owner") return c.json({ error: "Only owners can revoke invites" }, 403);
  await env.DB.prepare(
    `UPDATE invites SET revoked_at = ? WHERE house_id = ? AND substr(token_hash, 1, 12) = ?
     AND accepted_at IS NULL AND revoked_at IS NULL`,
  )
    .bind(Date.now(), houseId, c.req.param("inviteId"))
    .run();
  return c.json({ ok: true });
});

type InviteRow = {
  house_id: string;
  house_name: string;
  inviter_name: string | null;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
};

async function loadInvite(token: string) {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT i.house_id, h.name AS house_name, u.name AS inviter_name, i.expires_at, i.accepted_at, i.revoked_at
     FROM invites i JOIN houses h ON h.id = i.house_id LEFT JOIN users u ON u.id = i.created_by
     WHERE i.token_hash = ?`,
  )
    .bind(hash)
    .first<InviteRow>();
  if (!row) return null;
  const status = row.revoked_at ? "revoked" : row.accepted_at ? "used" : row.expires_at < Date.now() ? "expired" : "valid";
  return { hash, row, status: status as "valid" | "used" | "expired" | "revoked" };
}

houseRoutes.get("/invites/:token", async (c) => {
  const inv = await loadInvite(c.req.param("token"));
  if (!inv) return c.json({ error: "Invite not found" }, 404);
  return c.json({ house_name: inv.row.house_name, inviter_name: inv.row.inviter_name, status: inv.status });
});

houseRoutes.post("/invites/:token/accept", async (c) => {
  const user = await userFromRequest(c);
  const denied = needUser(c, user);
  if (denied) return denied;
  if (!(await allow(env.SENSITIVE_LIMIT, "accept", c.req.header("cf-connecting-ip")))) {
    return c.json({ error: "Too many attempts. Try again in a minute." }, 429);
  }
  const inv = await loadInvite(c.req.param("token"));
  if (!inv) return c.json({ error: "Invite not found" }, 404);
  const house = { id: inv.row.house_id, name: inv.row.house_name };
  const existing = await roleIn(user!.id, house.id);
  if (existing) return c.json({ house: { ...house, role: existing } });
  if (inv.status !== "valid") return c.json({ error: `This invite is ${inv.status}`, status: inv.status }, 410);
  const now = Date.now();
  const claimed = await env.DB.prepare(
    `UPDATE invites SET accepted_by = ?, accepted_at = ?
     WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
  )
    .bind(user!.id, now, inv.hash, now)
    .run();
  if (!claimed.meta.changes) {
    const again = await loadInvite(c.req.param("token"));
    return c.json({ error: "This invite is no longer valid", status: again?.status ?? "used" }, 410);
  }
  await env.DB.prepare("INSERT OR IGNORE INTO members (house_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)")
    .bind(house.id, user!.id, now)
    .run();
  return c.json({ house: { ...house, role: "member" } });
});
