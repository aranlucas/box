# Houses, sign-in and invites: Design

Date: 2026-11-18
Status: Draft, pending approval (builder check done)
Builds on: `2026-11-18-moving-box-tracker-design.md`

## Intent

Replace the single shared household key with real accounts.

- People sign in with their existing account on the user's own auth service, `https://auth.aranlucas.workers.dev` (Better Auth, OIDC provider).
- Boxes belong to a **house**.
- The house owner invites people (partner, family, helpers) with a link. Accepting it makes them a member.
- Members can add, edit, search and print that house's boxes.
- Anyone with a box's QR link can still **view** that one box, as today.

## Decisions the user made

- Houses are **only for the box app** for now (approach A below), not shared Auth organizations.
- Invites go out as links. "Create an app" means registering this app as an OIDC client on the auth service.

## Goals

- Sign in on the web and in the Android app with the auth service account (Google, GitHub, passkey, email/password, whatever Auth offers).
- **Create a house.** A first-time user with no house is asked to name one.
- **Invite by link.**
  - The owner taps "Invite", gets a link, and shares it any way they like (text, chat).
  - The invitee opens it, signs in or signs up on Auth, and joins.
- **Every box belongs to exactly one house.**
  - Box numbers are sequential **per house**.
  - Only that house's members can list, search, edit, add photos to, print or delete its boxes.
- **Existing boxes carry over** into the first house, with nothing lost.
- **Retire the household key.**

## Non-goals

- Houses or organizations shared with other apps (approach B, deferred).
- Changes to the auth repo, other than registering one client.
- Email delivery of invites.
- Fine-grained roles. There are two: **owner** (can invite and remove members) and **member** (everything with boxes).
- Moving boxes between houses.
- Android App Links. QR and invite links open in the browser.

## Anti-goals

- A box's contents becoming visible to someone who has neither its link nor membership in its house.
- An invite link that can be reused forever or by many people.
- Locking the user out of the boxes they already packed today.
- Breaking the "scan a label, no login" flow.

## Approaches considered

| | Approach | Trade-off |
|-|-|-|
| **A (chosen)** | Sign-in from Auth via OIDC; houses, members and invite links in the box app's D1; the box Worker keeps its own sessions. | No auth-repo changes; invite-by-link works without email. Houses exist only in this app. |
| B | Houses are Better Auth organizations in Auth (the plugin is enabled but unused). | Shareable across apps, but needs house and invite UI, membership in tokens or an API, and invite delivery in the auth repo. |

## Constraints (from the auth repo and its discovery document)

- **Issuer and endpoints.**
  - Issuer: `https://auth.aranlucas.workers.dev/api/auth`.
  - Endpoints: `/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo`, `/jwks`.
  - ID tokens are RS256 with PKCE S256. The token endpoint supports `client_secret_basic`.
- **Client registration.** Only an Auth admin can register a client (`/account/operator` → **Create client**), and redirect URIs must match exactly. **The user does this step.**
- **Session model.** The auth README recommends "OIDC and an app-local session" for apps on other domains.
- **Access tokens.** These are short-lived (about 15 minutes). The box app doesn't call Auth after sign-in, so it doesn't need them.

## Design

### Client registration (user action)

Create one client on `/account/operator`:

| Field | Value |
|-|-|
| Name | Moving Boxes |
| Type | **web** (confidential, gets a client secret) |
| Redirect URL | `https://bx.aranlucas.workers.dev/auth/callback` |
| Scopes | `openid profile email` |
| Second redirect URL (local dev) | `http://localhost:8788/auth/callback` |

The client ID and secret become Worker secrets: `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET`.

### Sign-in flow (the Worker is the OIDC client: "backend for frontend")

1. **`GET /auth/login`**
   - Query parameters: `return` (a same-origin path) and, for the Android app, `native_challenge`.
   - The Worker creates `state`, `nonce` and a PKCE verifier, and stores them in an `auth_requests` row with a 10-minute expiry.
   - It then redirects to Auth's authorize endpoint (`scope=openid profile email`, `code_challenge`).
2. **`GET /auth/callback`**
   - Checks `state` and exchanges the code at the token endpoint, using `client_secret_basic` plus the PKCE verifier.
   - Verifies the ID token (signature via JWKS, plus `iss`, `aud`, `exp` and `nonce`).
   - Upserts the user by `sub`, storing their email and name.
   - Creates a box-app **session**: a random 32-byte token, stored hashed, valid for 90 days and extended on use.
3. **Web.** The callback sets an `HttpOnly; Secure; SameSite=Lax` session cookie and redirects to `return`.
4. **Native (Android).** The app opens `/auth/login?native_challenge=S256(v)` with `expo-web-browser` `openAuthSessionAsync`.
   - The callback redirects to `boxes://auth?code=<one-time code>`. The code is single-use, expires in 60 s, and is bound to the challenge.
   - The app `POST`s `/auth/native/exchange` with `{ code, verifier }` and receives the session token.
   - It stores the token in `expo-secure-store` and sends it as `Authorization: Bearer`.
   - Binding the code to the challenge stops another app that registers `boxes://` from using an intercepted code.
5. **`POST /auth/logout`** deletes the session.

The API accepts the cookie or the bearer token. The household key header is removed.

### Houses and invites

- **`POST /api/houses`** creates a house (`{ name }`). The creator becomes its owner.
  - **Only someone who already owns a house can create another (my call).** A stranger who signs in with an Auth account sees "Ask a household member for an invite" and can't upload, so they can't spend the AI budget. This replaces the household key's protection.
  - The first owner gets their house by claiming "Home" (below).
- **`GET /api/me`** returns the user, their houses (with role) and the current house.
  - The current house is chosen per device and stored client-side.
  - API calls carry `x-house-id`, and the server checks membership on every request.
- **`POST /api/houses/:id/invites`** (owner only) creates an invite and returns `https://bx…/invite/<token>`.
  - The token is random and stored hashed.
  - It is **single-use** and **expires after 7 days**.
  - Owners can list and revoke pending invites.
- **`/invite/<token>` (web page).**
  - Shows "Join *House name*", plus who invited you.
  - If you're not signed in, it signs you in and comes back to this page.
  - **Accept** calls `POST /api/invites/<token>/accept`, which marks the invite used and adds you as a member.
  - Expired, used and revoked invites show a clear message.
- **Members screen** (owner): see members, remove a member, create or revoke invites.

### Data model (D1 migration 0002)

```sql
users(id TEXT PK, auth_sub TEXT UNIQUE NOT NULL, email TEXT, name TEXT, created_at INTEGER NOT NULL)
sessions(token_hash TEXT PK, user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
         expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)
auth_requests(state TEXT PK, verifier TEXT NOT NULL, nonce TEXT NOT NULL, return_to TEXT,
              native_challenge TEXT, expires_at INTEGER NOT NULL)
native_codes(code_hash TEXT PK, session_token TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL)
houses(id TEXT PK, name TEXT NOT NULL, created_at INTEGER NOT NULL)
members(house_id TEXT REFERENCES houses ON DELETE CASCADE, user_id TEXT REFERENCES users ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner','member')), created_at INTEGER NOT NULL,
        PRIMARY KEY (house_id, user_id))
invites(token_hash TEXT PK, house_id TEXT NOT NULL REFERENCES houses ON DELETE CASCADE,
        created_by TEXT NOT NULL REFERENCES users, expires_at INTEGER NOT NULL,
        accepted_by TEXT REFERENCES users, accepted_at INTEGER, revoked_at INTEGER)
boxes: + house_id TEXT NOT NULL REFERENCES houses; UNIQUE(house_id, number)  -- table rebuild
```

- **Native codes.** `native_codes.session_token` holds the token only until it is exchanged, for at most 60 s, and the row is deleted on use.
- **Cleanup.** Expired rows are pruned opportunistically on login.

### Migrating today's boxes

- Migration 0002 creates a house named **"Home"** with no members and assigns every existing box to it, keeping their numbers.
- **Claiming the house (my call).**
  - While "Home" has no owner, **any** signed-in user can claim it by entering the **old household key**. The first-run screen offers this.
  - It works whether or not that user already belongs to another house.
  - The claim makes them the owner.
- **Transition, so packing never stops (my call).**
  - Until "Home" is claimed, the Worker still accepts the household key header, scoped to "Home" only. The v1.0.0 APK and already-set-up browsers keep working.
  - A successful claim switches the key off immediately: the key check requires "Home" to have no owner.
  - Deleting the `HOUSEHOLD_KEY` secret later is cleanup.
- **Rollout order:**
  1. The user registers the client.
  2. I set the client secrets and deploy.
  3. The user signs in and claims "Home".
  4. The user installs v1.1.0.
- This keeps the existing key as proof of ownership, without putting anyone's email in config.

### Box links and printing

- Unchanged. The public box page still shows one box by its unguessable ID, and the label and QR format is identical.
- Already-printed labels keep working.
- A signed-in member of the box's house sees the editable view. Everyone else sees the read-only view.

### Release

- The web app updates on deploy.
- **Android v1.1.0** is needed, because the old APK sends the household key. It's published as a GitHub release, as before.
- New native dependencies: `expo-web-browser` (already installed) and `expo-secure-store`.

## Left to the builder

- **Where sign-in code lives.** Raw `fetch` against the endpoints, or a small OIDC library that runs on Workers. Either way, JWKS verification uses WebCrypto.
- **Rate limiting** of `/auth/*` and invite acceptance. Basic per-IP limits are enough.
- Exact copy and screen layout, following the existing app style.
- Tests:
  - Worker unit tests for the auth callback (with a fake token endpoint), membership checks, invite lifecycle and the migration.
  - An end-to-end sign-in against the real Auth, once the client exists.
