# Houses, Sign-in and Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the household key with sign-in from `auth.aranlucas.workers.dev`, give every box a house, and let owners invite members with single-use links.

**Architecture:**
- The box Worker is a confidential OIDC client. It runs the authorization-code flow with PKCE, verifies the ID token with `jose`, and issues its own session.
  - On the web, the session is an HttpOnly cookie.
  - On Android, it is a bearer token, obtained through a one-time code bound to a challenge the app generates.
- Houses, members and invites live in the box app's D1. Every box route checks membership.

**Tech Stack:** Hono on Workers, D1, `jose`, Expo Router, `expo-web-browser`, `expo-secure-store`, `expo-crypto`.

**Spec:** `docs/superpowers/specs/2026-11-18-houses-and-sign-in-design.md`

## Global Constraints

**OIDC**
- Issuer: `https://auth.aranlucas.workers.dev/api/auth`
- Authorize: `…/oauth2/authorize`; token: `…/oauth2/token`; JWKS: `…/jwks`
- Scope: `openid profile email`; PKCE: S256; token endpoint authentication: `client_secret_basic`
- Redirect URI (exactly): `https://bx.aranlucas.workers.dev/auth/callback`
- Worker secrets: `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`. These are already in `apps/worker/.dev.vars`; the client ID is `tBKlWUfUjWpUXONjLtvJmFwwSRLdECwp`.

**Sessions**
- Cookie `bx_session`, set as `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Lasts 90 days. It slides: the expiry is extended when less than 60 days remain.
- Stored as a SHA-256 hash.
- The native app sends `Authorization: Bearer <token>`.

**Native sign-in**
- The app opens `/auth/login?native_challenge=<base64url(sha256(verifier))>`.
- The callback redirects to `boxes://auth?code=<code>`. The code is single-use, valid for 60 s, and bound to the challenge.
- The app calls `POST /auth/native/exchange {code, verifier}` and gets back `{token}`.

**Invites**
- The token is random; only its hash is stored.
- An invite is single-use, expires after 7 days, and can be revoked.
- Link format: `https://bx.aranlucas.workers.dev/invite/<token>`.

**Houses**
- Roles: `owner` and `member`.
- Only users who already own a house may create another.
- The legacy house has id `HOME0000` and name `Home`.

**Legacy key**
- `x-household-key` grants access to `HOME0000` only, and only while `HOME0000` has no owner.
- `POST /api/houses/HOME0000/claim {key}` makes the caller its owner, and only while it has no owner.

**Client and box APIs**
- Clients send `x-house-id` for list and create.
- Box-by-id routes check membership in the box's own house.
- `GET /api/boxes/:id` stays public and adds `can_edit: boolean`.
- Box numbers are unique per house, as `UNIQUE(house_id, number)`.

**Safety**
- The `return` path must start with `/` and not with `//`.
- Never put `DEV_*` or dev-only values in `.dev.vars`. That file is uploaded as production secrets.

## Review Focus

1. **Migration data loss.** Rebuilding `boxes` must not cascade-delete `items` or `photos`. Test: after migrating a seeded local D1, the counts and the box numbers match. (Task 1)
2. **Cross-house access.** A member of house A must not be able to PATCH, PUT items, add photos to or DELETE a box in house B by its ID. Test: each returns 403. (Task 3)
3. **Invite reuse and expiry.** A second accept, an expired invite and a revoked invite are all rejected. Test: each returns 410 with a reason. (Task 3)
4. **Legacy key after claim.** Once Home is claimed, the household key gets 401. Test included. (Task 3)
5. **Open redirect through `return`.** `return=//evil.com` and `return=https://evil.com` fall back to `/`. Unit test. (Task 2)

---

### Task 1: Migration 0002 (houses, auth tables, boxes rebuilt with `house_id`)

**Files:**
- Create: `apps/worker/migrations/0002_houses_auth.sql`
- Test: `apps/worker/test/migrate-check.sh`

**Interfaces:**
- Produces these tables, exactly as in the spec's data model: `users`, `sessions`, `auth_requests`, `native_codes`, `houses`, `members`, `invites`, and `boxes` with `house_id TEXT NOT NULL REFERENCES houses(id)` and `UNIQUE(house_id, number)`.
- Seeds the house `('HOME0000','Home')`.

- [ ] **Step 1: Write `test/migrate-check.sh`.** It runs against the local D1 and prints `boxes`, `items` and `photos` counts plus `group_concat(number)`, before and after applying migrations. It exits non-zero on any difference, or if any box has `house_id != 'HOME0000'`.
- [ ] **Step 2: Write the migration, avoiding cascades.**
  1. Create `boxes_new`, `items_new` and `photos_new`, with `items_new` and `photos_new` referencing `boxes_new`.
  2. Copy all rows, setting `house_id='HOME0000'`.
  3. Drop `photos`, then `items`, then `boxes`. Children go first, so nothing cascades.
  4. Rename `*_new` to the original names. SQLite rewrites the FK targets on rename.
  5. Recreate the indexes.
- [ ] **Step 3: Run the check against a fresh local DB seeded with 2 boxes, 3 items and 2 photos.** Expected: identical before and after, and exit code 0.
- [ ] **Step 4: Commit** with the message `feat(worker): migration for houses, auth tables, house-scoped boxes`.

### Task 2: OIDC client, sessions, auth routes

**Files:**
- Create: `apps/worker/src/auth/oidc.ts`, `apps/worker/src/auth/session.ts`, `apps/worker/src/auth/routes.ts`, `apps/worker/src/util.ts`
- Modify: `apps/worker/cloudflare.config.ts` (add the `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET` secrets), `apps/worker/package.json` (add `jose` and `vitest`)
- Test: `apps/worker/test/auth.test.ts` (vitest, Node; no D1)

**Interfaces:**
- `util.ts`:
  - `randomToken(bytes=32): string` (base64url)
  - `sha256Hex(s: string): Promise<string>`
  - `s256(verifier: string): Promise<string>` (base64url)
  - `safeReturnPath(p: string | undefined): string`
- `oidc.ts`:
  - `authorizeUrl({state, nonce, challenge, clientId}): string`
  - `exchangeCode({code, verifier, clientId, clientSecret}, fetchImpl?=fetch): Promise<{id_token: string}>`
  - `verifyIdToken(idToken, {clientId, nonce, jwks?}): Promise<{sub: string; email?: string; name?: string}>`. `jwks` defaults to `createRemoteJWKSet(JWKS_URL)`.
- `session.ts`:
  - `createSession(db, userId): Promise<string>` (returns the raw token)
  - `userFromRequest(c): Promise<{id: string; email: string|null; name: string|null} | null>` (reads the cookie or bearer; slides the expiry)
  - `endSession(c): Promise<void>`
- `routes.ts` exports `authRoutes: Hono`:
  - `GET /auth/login`, `GET /auth/callback`, `POST /auth/native/exchange`, `POST /auth/logout`
  - `GET /auth/dev-login?sub=&name=`, which only responds when `new URL(c.req.url).hostname` is `127.0.0.1` or `localhost`, and 404s otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `safeReturnPath` maps `'/b/X'`→`'/b/X'`, `'//evil.com'`→`'/'`, `'https://evil.com'`→`'/'` and `undefined`→`'/'`.
  - `s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'` (RFC 7636 vector).
  - `verifyIdToken` uses a local `jose` key pair with `createLocalJWKSet`. It accepts a token with the right `iss`, `aud` and `nonce`, and rejects a wrong `aud`, a wrong `nonce` and an expired token.
  - `exchangeCode` sends a Basic auth header and a form body containing `code_verifier`, checked with a stub `fetchImpl`.
- [ ] **Step 2: Run `pnpm --filter worker test`.** Expected: FAIL, because the modules don't exist yet.
- [ ] **Step 3: Implement `util.ts`, `oidc.ts`, `session.ts` and `routes.ts`.**
  - The callback upserts `users` on `auth_sub`.
  - Web: set the cookie and redirect to `return_to`.
  - Native: insert a `native_codes` row and redirect to `boxes://auth?code=`.
  - `exchange` checks that `s256(verifier)` equals the stored challenge, then deletes the row.
  - Expired `auth_requests` and `native_codes` are pruned on `/auth/login`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(worker): OIDC sign-in with app sessions`.

### Task 3: Houses, invites, claim, house-scoped boxes

**Files:**
- Create: `apps/worker/src/houses.ts`, `apps/worker/test/api-check.sh`
- Modify: `apps/worker/src/index.ts` (replace `requireKey` with `requireUser`, `houseFromRequest` and `requireBoxMember`; scope every box query by `house_id`; mount `authRoutes`; add `/invite/*` and `/auth/*` to the Worker-first routes in `cloudflare.config.ts`)

**Interfaces:**
- Consumes `userFromRequest` and `createSession` from Task 2.
- Produces these routes:
  - `GET /api/me` → `{user: {id, name, email} | null, houses: {id, name, role}[], legacyHomeClaimable: boolean}`
  - `POST /api/houses {name}` → `{house}`; 403 unless the caller already owns a house
  - `POST /api/houses/HOME0000/claim {key}` → `{house}`; 409 if Home already has an owner
  - `GET /api/houses/:id/members` → `{members: {user_id, name, email, role}[], invites: {id, expires_at, created_at}[]}`
  - `DELETE /api/houses/:id/members/:userId` (owner only; can't remove the last owner)
  - `POST /api/houses/:id/invites` → `{url, expires_at}` (owner only)
  - `DELETE /api/houses/:id/invites/:inviteId`, where `inviteId` is the first 12 characters of the token hash
  - `GET /api/invites/:token` → `{house_name, inviter_name, status: 'valid'|'used'|'expired'|'revoked'}` (public)
  - `POST /api/invites/:token/accept` → `{house}`. 410 with `{error, status}` when the invite isn't valid; idempotent if the caller is already a member.
  - `GET /api/boxes/:id` adds `can_edit`.
- **Access rule:** list and create use `x-house-id` (membership required). Box-by-id routes use the box's own `house_id`. A legacy-key request counts as a member of `HOME0000` only while it has no owner.

- [ ] **Step 1: Write `test/api-check.sh`.** It runs against `cf dev` on `127.0.0.1:8788`, uses `/auth/dev-login` to get cookies for users A and B, and asserts the following:
  - A claims Home with the key, then the key gets 401 on `GET /api/boxes` and on a second claim (409).
  - A creates an invite. B accepts (200). A second accept by B is idempotent. A third user C accepting the same token gets 410 `used`.
  - B, as a member, can list Home's boxes. B cannot create a house (403).
  - A creates house "Garage" and a box in it.
  - With B removed from Home, B gets 403 when PATCHing a Home box. A user in neither house gets 403 on PATCH, PUT items and DELETE of a Garage box.
  - A revoked invite gets 410 `revoked`.
  - `GET /api/boxes/:id` without a cookie returns 200 with `can_edit:false`. With A's cookie it returns `can_edit:true`.
  - Box numbers restart at 1 in "Garage".
- [ ] **Step 2: Run it against the current code.** Expected: FAIL (`/auth/dev-login` 404).
- [ ] **Step 3: Implement `houses.ts` and update `index.ts`.** The box number subquery becomes `MAX(number) WHERE house_id = ?`.
- [ ] **Step 4: Run `pnpm migrate:local`, `pnpm dev`, then the script.** Expected: all assertions pass. Also run `tsc` with no errors.
- [ ] **Step 5: Commit** with the message `feat(worker): houses, invites, claim, house-scoped box access`.

### Task 4: App sign-in, session and house context

**Files:**
- Create: `apps/app/src/lib/auth.ts`, `apps/app/src/lib/auth.web.ts`, `apps/app/src/lib/session-store.ts`
- Modify: `apps/app/src/lib/api.ts` (remove the household key; send `x-house-id` and `Authorization` on native; add `me`, `houses`, `invites` and `claimHome` calls), `apps/app/package.json` (`expo-secure-store`, `expo-crypto` via `npx expo install`)
- Delete: `apps/app/src/app/setup.tsx`

**Interfaces:**
- `auth.ts` (native):
  - `signIn(): Promise<boolean>`. It generates a verifier with `expo-crypto` `getRandomBytes(32)`, computes the challenge by SHA-256 digest converted to base64url, calls `WebBrowser.openAuthSessionAsync(API_BASE + '/auth/login?native_challenge=…', 'boxes://auth')`, exchanges the code, and stores the token with SecureStore under `session-token`.
  - `signOut(): Promise<void>`
  - `authHeader(): Promise<Record<string,string>>`
- `auth.web.ts`:
  - `signIn(returnTo?: string)` sets `window.location.href = '/auth/login?return=' + encodeURIComponent(returnTo ?? location.pathname)`.
  - `signOut()` POSTs `/auth/logout` and then reloads.
  - `authHeader()` returns `{}`; the cookie travels with same-origin requests.
- `session-store.ts`:
  - `useSession(): {me: Me | null; loading: boolean; house: House | null; setHouse(id): void; refresh(): Promise<void>}`
  - The current house id is stored in AsyncStorage under `house-id`. It defaults to the first house.

- [ ] **Step 1: Implement and run `pnpm --filter app typecheck`.** Expected: no errors.
- [ ] **Step 2: Commit** with the message `feat(app): sign-in via auth service, session and house context`.

### Task 5: App screens (first run, claim, house and members, invites, switcher, box editing)

**Files:**
- Modify: `apps/app/src/app/index.tsx`, `apps/app/src/app/b/[id].tsx` (use `box.can_edit` instead of key presence), `apps/app/src/app/_layout.tsx`
- Create: `apps/app/src/app/house.tsx`, `apps/app/src/app/invite/[token].tsx`

**Behaviour:**
- **Index, signed out:** "Sign in" button, plus the existing "Just unpacking?" hint.
- **Index, signed in with no house:** a "Claim your existing boxes" card (key field → `claimHome`) shown when `legacyHomeClaimable`, plus "Ask a household member for an invite link."
- **Index, signed in with a house:** the house name in the header. Tapping it switches house when there is more than one. A "People" link goes to `/house`, and "Sign out" sits in the footer.
- **`/house`:**
  - Shows the members list.
  - Owners also see "Invite someone", which creates a link and opens the share sheet via `Share.share({message: url})`. On the web it copies to the clipboard as a fallback.
  - Owners also see pending invites with Revoke, Remove member, and "New house" (name field).
- **`/invite/[token]`:**
  - Shows "Join *house* (invited by *name*)" and the invite's status.
  - Signed out: "Sign in to join", which returns to this page.
  - Signed in: "Join", which accepts, sets the current house, and then goes to `/`.

- [ ] **Step 1: Implement, then run typecheck and `pnpm export:web`.** Expected: no errors.
- [ ] **Step 2: Run `cf dev` locally and use `/auth/dev-login` in headless Chrome.** Screenshot the signed-out index, the claim card, `/house` and the invite page. Expected: each renders with no console errors.
- [ ] **Step 3: Commit** with the message `feat(app): houses, members, invites, claim flow`.

### Task 6: Ship

**Files:** none new.

- [ ] **Step 1: Back up the remote D1** with `cf d1 export` (or the matching command) to the scratchpad. Expected: an SQL file containing today's boxes.
- [ ] **Step 2: Apply remote migrations** with `pnpm --filter worker migrate`, then check that box, item and photo counts are unchanged and every box has `house_id='HOME0000'`.
- [ ] **Step 3: Run `pnpm run deploy`.** It uploads secrets from `.dev.vars`, now including `AUTH_CLIENT_*`.
  - Smoke test: `/auth/login` returns 302 to the Auth authorize URL with `client_id`, `code_challenge` and the exact `redirect_uri`.
  - `/api/me` returns `{user:null}`.
  - The legacy key still lists Home.
  - A public box GET returns 200.
- [ ] **Step 4: Build Android v1.1.0.**
  - Set `version` to 1.1.0 and `versionCode` to 2.
  - Run an arm64 release build.
  - Smoke test on the emulator: the signed-out screen and the Sign in button opening the browser to Auth.
- [ ] **Step 5: Commit, push `main`, and create GitHub release `v1.1.0`** with the APK.
- [ ] **Step 6: Hand off to the user.**
  - They sign in on web or Android and claim Home with the old key.
  - Then they invite their partner.
  - Afterwards, delete the `HOUSEHOLD_KEY` secret.
