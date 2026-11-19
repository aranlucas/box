# Moving Box Tracker: Design

Date: 2026-11-18
Status: v1 shipped 2026-11-18 (web + Worker). Native Android BLE printing is next.

## Intent

The user is moving house and wants to know what's in each box without keeping a full inventory. The packing step should take seconds:

1. Tap **New box**.
2. Take a photo of the open box.
3. AI lists the contents and suggests a short title.
4. A Phomemo D30 Bluetooth label maker prints a label with the title and a QR code.

When unpacking, anyone scans the QR code with a phone camera. That opens a page showing the box's contents and photo(s). Contents can be edited at any time, to fix things the AI missed or got wrong.

## Goals

- **One-photo packing.** "New box" → photo → reviewed list → printed label, in well under a minute and with no typing required.
- **Scan to see contents.** A phone camera opens the box page in any browser. No app or login is needed.
- **Editable contents.** Add, rename and remove items, change the title, add more photos, and reprint the label.
- **Find a box.** List all boxes and search items ("which box has the blender?").
- **Runs on Android (native app) and the web (Chrome on desktop or Android).** Both can print to the D30.
- **Hosted entirely on Cloudflare.** Workers runs the API and the web app, D1 holds the data, R2 holds the photos, and deployment uses the `cf` CLI.

## Non-goals

- Printing from iOS. Safari has no Web Bluetooth, and no iOS native build is planned. iOS users can still scan and view box pages.
- A complete, valuation-grade inventory, or item-level tracking across boxes.
- Accounts, multiple households, or multiple moves.
- Publishing to the Play Store. The Android app is a local or EAS-built APK.
- Printing the photo on the label. At 12 mm tall on a monochrome thermal printer, a photo would be useless.
- Offline packing. The flow needs a network connection for upload and AI.

## Anti-goals: failure even if it technically works

- The QR code on the printed label doesn't scan reliably from a normal phone camera.
- The label's title is truncated into something unreadable.
- Packing a box takes enough taps or waiting that the user stops bothering.
- Box links are guessable, so a stranger could enumerate the household's belongings.

## Constraints

- **Printer.** Phomemo D30, Bluetooth LE, 12 mm-wide thermal labels at about 203 dpi. The exact geometry and protocol are in [Printing](#printing-phomemo-d30). The label is tiny: a QR code of about 10 mm, plus 2–4 words of text.
- **Web Bluetooth is Chromium-only** (Chrome or Edge on desktop and Android). It requires HTTPS (or localhost) and a user gesture to start pairing.
- **Native Android BLE** needs a development build (`expo prebuild` / `expo run:android` or EAS). Expo Go cannot load the BLE native module.
- **The `cf` CLI (v1.0.0-beta)** uses `cloudflare.config.ts`.
  - `cf` delegates builds to a framework or to the Cloudflare Vite plugin/Wrangler.
  - `cloudflare.config.ts` has no `assets.directory` field. The asset source comes from the build tool: the Vite client build output plus `publicDir`, or Wrangler's generated `wrangler.config.ts`.
  - `cf deploy` does not write provisioned resource IDs back.
  - D1 migrations need the database ID.
  - **Do not run `cf dev`, `cf build` or `cf deploy` before `cloudflare.config.ts` exists.** Without a terminal, they auto-configure the project and install packages.
- **Local machine.** An Android SDK, `adb` and JDK 17 are present, so local `expo run:android` is feasible. `cf` is already signed in.

## Approaches considered

| | Approach | Trade-off |
|-|-|-|
| A | Expo universal app, web first. Android uses the installable web app and prints over Web Bluetooth. Native build later. | Fastest to a working printer. The native app is deferred. |
| **B (chosen)** | **Expo universal app with a native Android build from day one.** It prints over native BLE on Android and over Web Bluetooth on the web. | Two Bluetooth transports, and an APK is needed before Android can print natively. The user picked this. |
| C | Plain React + Vite web app, no React Native. | Leanest, but the user prefers React Native, and a native app later would mean a rewrite. |

The user chose **B**. They want a real Android app, with the web as a peer.

## Decisions the user made

- Approach B: Expo (React Native, Metro) targeting Android and web.
- Cloudflare Workers + D1 + R2, deployed with the `cf` CLI.
- Vercel AI SDK for contents extraction, with **OpenAI vision** (`@ai-sdk/openai`, model `gpt-5.1` via the `OPENAI_MODEL` var).
- Box pages are open to anyone who has the link. The link carries an unguessable ID, so there is no login to view a box.
- Printer: Phomemo D30.

## Architecture

```
┌──────────────────────────── one repo (pnpm workspace) ───────────────────────────┐
│ apps/app      Expo Router app (Android + web)                                    │
│               ├─ screens: Boxes list/search · New box (camera) · Box detail/edit │
│               ├─ printer/transport.web.ts     Web Bluetooth                      │
│               └─ printer/transport.native.ts  react-native-ble-plx               │
│ packages/label  pure TS, no DOM/RN deps:                                         │
│               renderLabel({number,title,url}) → 1-bit bitmap                     │
│               encodeD30(bitmap) → Uint8Array[] (BLE-sized chunks)                │
│ apps/worker   Cloudflare Worker (Hono): /api/* + serves Expo web export as assets│
│               D1 (boxes/items/photos) · R2 (photos) · AI SDK → Anthropic         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **One origin.** The Worker serves both the API (`/api/*`) and the Expo web export as static assets, with an SPA fallback. A QR link like `https://<host>/b/<ID>` opens the web app's box page in any browser, with no CORS. The native app calls the same origin's API.
- **Deploy shape (builder to verify).** The Worker is built with the Cloudflare Vite plugin, using the Expo `expo export -p web` output (`dist/`) as the static asset source. That is either Vite `publicDir` or Wrangler's `wrangler.config.ts` assets directory, whichever `cf` supports cleanly. Prove it first with `cf deploy --dry-run`.
- **Shared label code.** `packages/label` is platform-independent. Native has no canvas, so QR generation and text rasterizing are pure TypeScript: a QR encoder library plus an embedded bitmap font. Web and Android produce byte-identical print jobs, and the encoder is unit-testable. Only the BLE transport differs between platforms.

## Data model (D1)

```sql
boxes(
  id TEXT PRIMARY KEY,          -- 8-char Crockford base32, random (~40 bits); used in the QR URL
  number INTEGER UNIQUE NOT NULL, -- human sequence: "Box 14", printed large on the label
  title TEXT NOT NULL,
  room TEXT,                    -- optional destination room ("Kitchen"), AI-suggested
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'packed',   -- 'packed' | 'unpacked'
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)
items(
  id TEXT PRIMARY KEY, box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  name TEXT NOT NULL, quantity INTEGER, source TEXT NOT NULL,  -- 'ai' | 'manual'
  position INTEGER NOT NULL
)
photos(
  id TEXT PRIMARY KEY, box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL, created_at INTEGER NOT NULL
)
```

Search uses `LIKE` over `boxes.title` and `items.name`, which is fine for hundreds of boxes. FTS5 is optional.

## API (Worker, Hono)

| Method & path | Guard | Purpose |
|-|-|-|
| `POST /api/boxes` (multipart: photo) | household key | Create a box: store the photo in R2, run AI extraction, insert box + items, return the box |
| `GET /api/boxes?q=` | household key | List or search boxes |
| `GET /api/boxes/:id` | link (ID) | Box + items + photo URLs |
| `PATCH /api/boxes/:id` | link (ID) | Edit title, room, notes, status |
| `PUT /api/boxes/:id/items` | link (ID) | Replace the item list (simple and conflict-tolerant enough here) |
| `POST /api/boxes/:id/photos` | household key | Add a photo. AI extracts and **appends** new items, tagged `ai` |
| `GET /api/photos/:id` | link (box ID) | Stream the photo from R2 |

**Access (my call; the user approved "open by link").**
- Viewing and editing a single box only needs its unguessable ID.
- Creating boxes, uploading photos, and listing/searching all boxes require a **household key**. This is a shared secret stored as a Worker secret, entered once per device, and sent as a header.
- Without the key, anyone could spend the AI budget or enumerate every box.

## AI extraction

- **Library.** Vercel AI SDK v6: `generateText({ model, output: Output.object({ schema }) })`. `generateObject` is deprecated in v6. The photo is passed as an `ImagePart`.
- **Provider (user decision).** `@ai-sdk/openai`. Model comes from the `OPENAI_MODEL` var (`gpt-5.1`), with the key as the `OPENAI_API_KEY` Worker secret.
- **Schema.**
  ```ts
  {
    title: string,                        // ≤ N chars, N set from the label's pixel budget
    room?: string,                        // likely destination room
    items: { name: string; quantity?: number }[],
  }
  ```
- **Prompt guidance.**
  - Return concrete, searchable item names.
  - Group obvious multiples ("6 wine glasses").
  - Don't invent hidden items.
  - The title is a 2–4 word summary for the label ("Kitchen – Glassware").
- **Image size.** The client downscales photos to a long edge of about 1600 px as JPEG before upload. This keeps uploads fast and tokens low.
- **Failure handling.** If AI fails or times out, the box is still created with the photo and an empty list, plus a default title ("Box 14"). The user can retry extraction or type items.

## Screens

1. **Boxes.** A searchable list showing number, title, room, item count and packed/unpacked status, plus a big **New box** button.
2. **New box.**
   - The camera opens: `expo-image-picker` / `expo-camera` on Android, and `<input type="file" capture="environment">` on the web.
   - Upload with a spinner ("Reading the box…"), then go to the review screen.
3. **Review / Box detail.** This is the same screen used for both.
   - Editable title (with a live character budget), room, and item list (add, rename, delete, quantity), plus photos.
   - Buttons: **Print label**, **Add photo**, **Mark unpacked**.
   - After creation it opens in review mode, with **Print label** as the primary action.
4. **Printer.** Connect or forget the D30. Shows connection state. Prints a test label.
5. **Public box page** (`/b/:id`). The same detail view in the browser. Editing is allowed per the access rules.

## Printing (Phomemo D30)

### Protocol

This is ESC/POS raster over BLE. Five independent BLE implementations agree on it: transcriptionstream/phomymo, tinytoast-dev/phomemo-d30, odensc/phomemo-d30-web-bluetooth, dmsc/web-label-printer and catdogmaus/D30printerPWA. polskafan/phomemo_d30 uses Bluetooth Classic RFCOMM, so its extra init packets are **not** needed over BLE.

- **GATT.**
  - Service `0000ff00-0000-1000-8000-00805f9b34fb`.
  - Write characteristic `FF02` (with or without response).
  - Notify characteristic `FF03` (status, optional).
  - `FF00` is **not advertised**; it only appears after connecting.
- **Discovery.**
  - Web: `requestDevice({ filters: [{ namePrefix: 'D30' }], optionalServices: [0xff00] })`. Fall back to `acceptAllDevices` behind a "Show all devices" link.
  - Native: scan with no service filter and match on the local name `D30*`.
- **Job bytes.** Width is in **bytes**, little-endian. There is a single raster header for the whole label.
  ```
  1B 40                       ESC @     init
  1D 76 30 00 0C 00 40 01     GS v 0    12 bytes/row × 320 rows
  <3840 bytes bitmap>         row-major, MSB = leftmost dot, 1 = black
  1B 64 00                    ESC d 0   finish; printer feeds to the die-cut gap
  ```
- **Geometry.** 8 dots/mm. The design canvas is a **320 × 96** landscape image (40 × 12 mm). It is rotated 90° into a 96-wide × 320-row raster.
  - Implementations split on clockwise vs counter-clockwise; they differ only by 180° on the tape.
  - Rotation is a config flag, defaulting to **clockwise**, confirmed at the first hardware test.
- **Chunking.**
  - Send the header as its own write, then 128-byte data chunks, then the footer.
  - **Web:** `writeValueWithResponse`, waiting for each write. Fall back to without-response plus a 20 ms delay.
  - **Android (ble-plx):** connect with `requestMTU: 185`. Chunk size is `min(128, mtu − 3)`, using `writeCharacteristicWithResponseForService`. Android's default MTU allows only 20-byte writes.
  - Wait about 500 ms between consecutive jobs (reprints, copies).
- **Not used in v1.** Density and heat commands are unverified for the D30. Status parsing from `FF03` (paper out, cover open, battery) would be nice to have later.
- **Thermal limit.** Keep black coverage well under 60% of the label. The QR code plus text is about 30%.
- **Bug to avoid.** Don't threshold only pure black. Rasterize the 1-bit image directly; the bitmap font plus QR modules are already binary.

**Label layout (12 × 40 mm, landscape as read):**

```
┌────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓  #14                           │
│ ▓ QR  ▓  KITCHEN GLASSWARE             │
│ ▓▓▓▓▓▓▓                                │
└────────────────────────────────────────┘
```

- **QR budget.** The label is 96 dots tall, and the QR code fills its height with **3 dots (0.375 mm) per module**. Smaller modules are a scan-reliability risk on curled cardboard, which is an anti-goal.
  - The URL is uppercased so the QR can use alphanumeric mode.
  - **Short custom domain:** `HTTPS://BX.EXAMPLE.COM/B/K7Q2M9P4` is about 33 chars. That gives a version 2 QR at error-correction level M: 25 modules × 3 = 75 dots, leaving 10 dots (about 3.5 modules) of white on each side. **Good.**
  - **`*.workers.dev`:** the URL is about 55 chars, which needs version 3 or 4 (29–33 modules). At 3 dots/module that is 87–99 dots, with a quiet zone of 1.5 modules or less. Dropping to 2 dots/module makes modules 0.25 mm. **Marginal.** A short domain is strongly preferred, and the hostname is permanent once labels are stuck on boxes.
  - The server matches `/b/:id` case-insensitively and normalizes IDs to uppercase, so the uppercased URL still works.
- **Budget.** The QR code takes about 80 dots on the left. That leaves about 230 × 96 dots for text: the box number in about 40-dot digits, and the title in one or two lines of a roughly 24-dot bold font (about 14 chars per line). The AI title limit is **24 characters**, and the review screen warns when a title won't fit.
- **Text.** The box number is printed large, with the title in one or two lines of a bold bitmap font. The AI's title length limit comes from this budget.
- **Transport.**
  - **Web:** `navigator.bluetooth.requestDevice` with a name-prefix filter.
  - **Android:** `react-native-ble-plx` through its Expo config plugin, with `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` runtime permissions.
  - Both write the same chunked byte array from `packages/label`.
  - The app remembers the last device, so later prints are one tap.

## Milestones (risk first)

1. **Print a test label.**
   - `packages/label` encoder plus a minimal web page that pairs with the D30 over Web Bluetooth and prints a QR code and text.
   - **The user must test this on the real printer.** I can't, and everything else builds on it.
2. **Worker, D1, R2 and AI.** Create a box from a photo and edit it, deployed with `cf`.
3. **Expo app (web).** All screens, served by the Worker, printing over Web Bluetooth.
4. **Android native build.** The BLE transport via `react-native-ble-plx`, plus an APK. The user verifies printing on the device.

## Left to the builder

- The QR library and bitmap font. The font must render legibly at 203 dpi in about 30–40 dots of height.
- The exact Vite/Wrangler arrangement for serving the Expo export from the Worker. Verify it with `cf deploy --dry-run`.
- Photo storage format. Store the client-resized JPEG as is; no server-side resizing.
- Test strategy: unit tests for `packages/label` (golden bitmaps and byte output) and for API handlers against local D1/R2.

## Decisions made on ship day (2026-11-18)

- **Domain:** the default address, `https://bx.aranlucas.workers.dev`. The Worker is named `bx` to keep the QR URL short: about 41 chars, a version 2 QR at level L with 3 dots per module.
- **Access:** anyone with a box link can **view** it. Creating, listing, searching, editing and printing all require the household key (header `x-household-key`).
  - To set a device up, open `/setup?key=<key>` once.
- **Scope order:** packing starts today. The web app (Expo web export served by the Worker) and Web Bluetooth printing ship first. The native Android BLE transport (`react-native-ble-plx`) follows.
- **Resources:** D1 `moving-boxes` (`52c32efc-6ee3-48d8-8b4e-f41ad071a511`) and R2 `moving-box-photos`.
