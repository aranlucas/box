import type { House, InviteInfo, InviteStatus, Me, Member, PendingInvite, Role } from '@mj/api';
import { env } from 'cloudflare:workers';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { userFromRequest, type User } from './auth/session.ts';
import { allow, body, PUBLIC_ORIGIN, randomToken, safeEqual, sha256Hex } from './util.ts';

export const HOME_ID = 'HOME0000';
const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;
const HOUSE_NAME_MAX = 60;
const TOO_MANY = 'Too many attempts. Try again in a minute.';

export type Actor = { user: User | null; legacy: boolean };

async function homeUnclaimed(): Promise<boolean> {
  const owner = await env.DB.prepare(
    "SELECT 1 FROM members WHERE house_id = ? AND role = 'owner' LIMIT 1",
  )
    .bind(HOME_ID)
    .first();
  return !owner;
}

async function roleIn(userId: string, houseId: string): Promise<Role | undefined> {
  const row = await env.DB.prepare('SELECT role FROM members WHERE house_id = ? AND user_id = ?')
    .bind(houseId, userId)
    .first<{ role: Role }>();
  return row?.role;
}

/**
 * Who is calling: a signed-in user, and/or a legacy household-key holder. The legacy key only
 * counts while Home has no owner, so claiming Home switches it off.
 */
export async function actorFrom(c: Context): Promise<Actor> {
  const user = await userFromRequest(c);
  const key = c.req.header('x-household-key');
  if (!key) {
    return { user, legacy: false };
  }
  if (!(await allow(env.KEY_LIMIT, 'key', c))) {
    throw new HTTPException(429, { message: TOO_MANY });
  }
  return { user, legacy: (await safeEqual(key, env.HOUSEHOLD_KEY)) && (await homeUnclaimed()) };
}

export async function canAccessHouse(actor: Actor, houseId: string): Promise<boolean> {
  if (actor.user && (await roleIn(actor.user.id, houseId))) {
    return true;
  }
  return actor.legacy && houseId === HOME_ID;
}

export type HouseEnv = { Variables: { houseId: string } };

/** Lets the request through as `c.var.houseId` if the caller may use that house; otherwise the refusal. */
export async function enterHouse(c: Context<HouseEnv>, houseId: string | undefined) {
  const actor = await actorFrom(c);
  if (!actor.user && !actor.legacy) {
    return c.json({ error: 'Sign in required' }, 401);
  }
  const id = houseId || (actor.legacy ? HOME_ID : undefined);
  if (!id) {
    return c.json({ error: 'Choose a house' }, 400);
  }
  if (!(await canAccessHouse(actor, id))) {
    return c.json({ error: 'Not a member of this house' }, 403);
  }
  c.set('houseId', id);
  return undefined;
}

/** The caller must belong to the house named by x-house-id (legacy key → Home). */
export const requireHouse = createMiddleware<HouseEnv>(
  async (c, next) => (await enterHouse(c, c.req.header('x-house-id'))) ?? next(),
);

type UserEnv = { Variables: { user: User } };

/** Routes behind this read the signed-in user from `c.var.user`. */
const requireUser = createMiddleware<UserEnv>(async (c, next) => {
  const user = await userFromRequest(c);
  if (!user) {
    return c.json({ error: 'Sign in required' }, 401);
  }
  c.set('user', user);
  return next();
});

export const houseRoutes = new Hono<UserEnv>();

houseRoutes.get('/me', async (c) => {
  const [user, legacyHomeClaimable] = await Promise.all([userFromRequest(c), homeUnclaimed()]);
  if (!user) {
    return c.json<Me>({ user, houses: [], legacyHomeClaimable });
  }
  const { results: houses } = await env.DB.prepare(
    `SELECT h.id, h.name, m.role FROM members m JOIN houses h ON h.id = m.house_id
     WHERE m.user_id = ? ORDER BY m.created_at`,
  )
    .bind(user.id)
    .all<House>();
  return c.json<Me>({ user, houses, legacyHomeClaimable });
});

const newHouse = z.object({
  name: z
    .string('Name required')
    .trim()
    .min(1, 'Name required')
    .max(HOUSE_NAME_MAX, `Use ${HOUSE_NAME_MAX} characters or fewer`),
});

// Only existing owners may create more houses: a stranger who signs in can't spend AI budget.
houseRoutes.post('/houses', requireUser, async (c) => {
  const { user } = c.var;
  const { name } = await body(c, newHouse);
  const owns = await env.DB.prepare(
    "SELECT 1 FROM members WHERE user_id = ? AND role = 'owner' LIMIT 1",
  )
    .bind(user.id)
    .first();
  if (!owns) {
    return c.json({ error: 'Ask a household member for an invite' }, 403);
  }
  const id = randomToken(9);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO houses (id, name, created_at) VALUES (?, ?, ?)').bind(
      id,
      name,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO members (house_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, user.id, now),
  ]);
  return c.json<{ house: House }>({ house: { id, name, role: 'owner' } });
});

const claim = z.object({ key: z.string('Wrong key').trim().min(1, 'Wrong key') });

houseRoutes.post('/houses/:id/claim', requireUser, async (c) => {
  if (c.req.param('id') !== HOME_ID) {
    return c.json({ error: 'Not found' }, 404);
  }
  if (!(await allow(env.SENSITIVE_LIMIT, 'claim', c))) {
    return c.json({ error: TOO_MANY }, 429);
  }
  const { key } = await body(c, claim);
  if (!(await safeEqual(key, env.HOUSEHOLD_KEY))) {
    return c.json({ error: 'Wrong key' }, 403);
  }
  // Single statement so two simultaneous claims can't both win.
  const res = await env.DB.prepare(
    `INSERT INTO members (house_id, user_id, role, created_at)
     SELECT ?1, ?2, 'owner', ?3 WHERE NOT EXISTS (SELECT 1 FROM members WHERE house_id = ?1 AND role = 'owner')
     ON CONFLICT (house_id, user_id) DO UPDATE SET role = 'owner'`,
  )
    .bind(HOME_ID, c.var.user.id, Date.now())
    .run();
  if (!res.meta.changes) {
    return c.json({ error: 'Home has already been claimed' }, 409);
  }
  return c.json<{ house: House }>({ house: { id: HOME_ID, name: 'Home', role: 'owner' } });
});

houseRoutes.get('/houses/:id/members', requireUser, async (c) => {
  const houseId = c.req.param('id');
  const role = await roleIn(c.var.user.id, houseId);
  if (!role) {
    return c.json({ error: 'Not a member of this house' }, 403);
  }
  const members = env.DB.prepare(
    `SELECT m.user_id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.house_id = ? ORDER BY m.role = 'owner' DESC, m.created_at`,
  )
    .bind(houseId)
    .all<Member>();
  // Only owners manage invites.
  const invites =
    role === 'owner'
      ? env.DB.prepare(
          `SELECT substr(token_hash, 1, 12) AS id, created_at, expires_at FROM invites
           WHERE house_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
           ORDER BY created_at DESC`,
        )
          .bind(houseId, Date.now())
          .all<PendingInvite>()
      : { results: [] };
  const [m, i] = await Promise.all([members, invites]);
  return c.json({ members: m.results, invites: i.results });
});

houseRoutes.delete('/houses/:id/members/:userId', requireUser, async (c) => {
  const { user } = c.var;
  const houseId = c.req.param('id');
  const target = c.req.param('userId');
  // Owners can remove anyone; members can remove themselves (leave).
  if (target !== user.id && (await roleIn(user.id, houseId)) !== 'owner') {
    return c.json({ error: 'Only owners can remove members' }, 403);
  }
  const targetRole = await roleIn(target, houseId);
  if (!targetRole) {
    return c.json({ error: 'Not a member' }, 404);
  }
  if (targetRole === 'owner') {
    const owners = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM members WHERE house_id = ? AND role = 'owner'",
    )
      .bind(houseId)
      .first<number>('n');
    if (owners === 1) {
      return c.json({ error: 'A house needs at least one owner' }, 400);
    }
  }
  await env.DB.prepare('DELETE FROM members WHERE house_id = ? AND user_id = ?')
    .bind(houseId, target)
    .run();
  return c.json({ ok: true });
});

houseRoutes.post('/houses/:id/invites', requireUser, async (c) => {
  const houseId = c.req.param('id');
  if ((await roleIn(c.var.user.id, houseId)) !== 'owner') {
    return c.json({ error: 'Only owners can invite' }, 403);
  }
  const token = randomToken(24);
  const now = Date.now();
  const expiresAt = now + INVITE_TTL;
  await env.DB.prepare(
    'INSERT INTO invites (token_hash, house_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256Hex(token), houseId, c.var.user.id, now, expiresAt)
    .run();
  return c.json({ url: `${PUBLIC_ORIGIN}/invite/${token}`, expires_at: expiresAt });
});

houseRoutes.delete('/houses/:id/invites/:inviteId', requireUser, async (c) => {
  const houseId = c.req.param('id');
  if ((await roleIn(c.var.user.id, houseId)) !== 'owner') {
    return c.json({ error: 'Only owners can revoke invites' }, 403);
  }
  await env.DB.prepare(
    `UPDATE invites SET revoked_at = ? WHERE house_id = ? AND substr(token_hash, 1, 12) = ?
     AND accepted_at IS NULL AND revoked_at IS NULL`,
  )
    .bind(Date.now(), houseId, c.req.param('inviteId'))
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

function inviteStatus(row: InviteRow): InviteStatus {
  if (row.revoked_at) {
    return 'revoked';
  }
  if (row.accepted_at) {
    return 'used';
  }
  return row.expires_at < Date.now() ? 'expired' : 'valid';
}

async function loadInvite(token: string) {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT i.house_id, h.name AS house_name, u.name AS inviter_name, i.expires_at, i.accepted_at, i.revoked_at
     FROM invites i JOIN houses h ON h.id = i.house_id LEFT JOIN users u ON u.id = i.created_by
     WHERE i.token_hash = ?`,
  )
    .bind(hash)
    .first<InviteRow>();
  return row && { hash, row, status: inviteStatus(row) };
}

houseRoutes.get('/invites/:token', async (c) => {
  const invite = await loadInvite(c.req.param('token'));
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }
  const { house_name, inviter_name } = invite.row;
  return c.json<InviteInfo>({ house_name, inviter_name, status: invite.status });
});

houseRoutes.post('/invites/:token/accept', requireUser, async (c) => {
  const { user } = c.var;
  // Invite tokens are 192-bit random, so this is hygiene, not guessing protection.
  if (!(await allow(env.LOGIN_LIMIT, 'accept', c))) {
    return c.json({ error: TOO_MANY }, 429);
  }
  const invite = await loadInvite(c.req.param('token'));
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }
  const house = { id: invite.row.house_id, name: invite.row.house_name };
  const existing = await roleIn(user.id, house.id);
  if (existing) {
    return c.json<{ house: House }>({ house: { ...house, role: existing } });
  }
  if (invite.status !== 'valid') {
    return c.json({ error: `This invite is ${invite.status}`, status: invite.status }, 410);
  }
  const now = Date.now();
  // One transaction: consume the invite and add the member only if this request consumed it.
  const [claimed] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE invites SET accepted_by = ?1, accepted_at = ?2
       WHERE token_hash = ?3 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?2`,
    ).bind(user.id, now, invite.hash),
    env.DB.prepare(
      `INSERT OR IGNORE INTO members (house_id, user_id, role, created_at)
       SELECT house_id, ?1, 'member', ?2 FROM invites WHERE token_hash = ?3 AND accepted_by = ?1 AND accepted_at = ?2`,
    ).bind(user.id, now, invite.hash),
  ]);
  if (!claimed?.meta.changes) {
    const again = await loadInvite(c.req.param('token'));
    return c.json(
      { error: 'This invite is no longer valid', status: again?.status ?? 'used' },
      410,
    );
  }
  return c.json<{ house: House }>({ house: { ...house, role: 'member' } });
});
