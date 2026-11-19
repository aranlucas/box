<img src="assets/icon.svg" width="64" height="64" alt="">

# moving-journey 📦

A moving-box tracker. Take one photo of what's inside a box. AI lists the contents and picks a short title, and a **Phomemo D30** Bluetooth label maker prints a label with a QR code. When unpacking, scan the QR code with any phone camera to see what's inside.

- **App:** Expo (React Native) for Android and the web, using Expo Router.
- **Backend:** a Cloudflare Worker (Hono) with D1 for data and R2 for photos, deployed with the `cf` CLI.
- **AI:** the Vercel AI SDK with OpenAI vision and text embeddings.
- **Printing:**
  - Web Bluetooth in Chrome on Android or desktop.
  - Native BLE in the Android app (`react-native-ble-plx`).
  - Both use the same pure-TypeScript label renderer and ESC/POS encoder (`packages/label`).

## Install the Android app

Download the APK from [Releases](../../releases) and install it. You'll need to allow installs from your browser. Then:

1. Open the app and enter your household key.
2. Turn on the D30.
3. Open **Settings** and tap **Connect printer**. Other devices in your house can now print through this phone while the app is open.

## Repo layout

| Path                     | What                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app`               | Expo app. Screens are in `src/app`. The printer transport is `src/lib/printer.ts` (native BLE) or `printer.web.ts` (Web Bluetooth). |
| `apps/worker`            | Cloudflare Worker: the API (`src/index.ts`), AI extraction (`src/ai.ts`), D1 migrations, and `cloudflare.config.ts`.                |
| `packages/label`         | Label layout (QR code + bitmap font), the D30 raster encoder, and Web Bluetooth helpers. Unit-tested.                               |
| `docs/superpowers/specs` | The design doc, including the reverse-engineered D30 protocol notes.                                                                |

## How access works

- **Viewing** a box only needs its link. The link contains an unguessable 8-character ID, and that's what the QR code holds.
- **Creating, listing, searching, editing and printing** need a shared household key. It is stored as the `HOUSEHOLD_KEY` Worker secret and sent as the `x-household-key` header.
- To set up a device, open `/setup?key=<key>` once.

## Search boxes

Use the search field on the Boxes screen for an item name, a description like “baking supplies,” or a box number like `#12`. Search stays within the selected house. Keyword matches appear first, followed by related boxes ranked by meaning. Keyword search also covers notes and works when semantic search is unavailable.

Semantic search sends the query and the box titles, rooms, and item names that need embeddings to OpenAI using the Worker's existing `OPENAI_API_KEY`. D1 caches the embeddings as you search, including for boxes created before the feature was added. Editing a box refreshes its embedding the next time it needs one.

## Printing from any device in the house

Only one device per house needs the D30 connected. Any other member's device in that house, including an iPhone (Safari has no Web Bluetooth), can print through it. The print button then says **Print label via _device name_**.

- A device with the printer connected and the app open shares it. It heartbeats `POST /api/printers/heartbeat` every 2 s, which keeps its row in the `printer_connections` table fresh. The table is per house (`x-house-id`), and Settings shows it as **Printers in this house**. While it's sharing, the host keeps its screen on, because a locked phone stops sharing.
- Other devices queue a `print_jobs` row. The host picks the job up on its next heartbeat, claims it atomically, prints it and reports back. The requesting device polls until it's done.
- A job nobody claims within 25 s fails with a clear error, so a phone that comes back later never prints stale labels. A host drops off the table 15 s after its last heartbeat, or right away when its printer disconnects or the app goes to the background.

Code: `apps/worker/src/printing.ts` (API) and `apps/app/src/lib/household.ts` (host loop and `printAnywhere`).

## Develop

Requires pnpm, Node 24 and the `cf` CLI (signed in).

```sh
pnpm install
pnpm lint                                   # workspace lint, including type-aware rules
pnpm format:check                           # check formatting
pnpm test                                   # workspace tests
pnpm --filter app check:expo                 # SDK dependency alignment and Expo Doctor

# Worker (needs apps/worker/.dev.vars with OPENAI_API_KEY and HOUSEHOLD_KEY)
cd apps/worker && pnpm migrate:local && pnpm dev

# Web app against a running Worker
cd apps/app && EXPO_PUBLIC_API_URL=http://localhost:8788 pnpm web
```

Run `pnpm lint:fix` to apply automatic lint fixes and `pnpm format` to format the workspace.

For Android development, run `EXPO_PUBLIC_API_URL=http://10.0.2.2:8788 pnpm android` from `apps/app` with the Worker running locally and an emulator connected. The Android build includes the native Bluetooth library required for printing. After changing native dependencies or config plugins, regenerate the Android project with `pnpm exec expo prebuild --platform android --clean` before rebuilding.

## Deploy

```sh
pnpm --filter worker migrate   # applies D1 migrations, including the search cache
pnpm run deploy   # exports the Expo web build, then `cf deploy` with the secrets in .dev.vars
```

To use your own Cloudflare account, create your own resources and point the config at them:

1. Create a D1 database and an R2 bucket with `cf d1 create` and `cf r2 buckets create`.
2. Put their IDs in `apps/worker/cloudflare.config.ts` and the `migrate` scripts.
3. Change the Worker `name` there too.

## Build the Android APK

```sh
cd apps/app && pnpm build:android
# → android/app/build/outputs/apk/release/app-release.apk
```

The Android app defaults to `https://bx.aranlucas.workers.dev`. Set `EXPO_PUBLIC_API_URL` when building to use a different Worker, such as a preview deployment.

## D30 protocol (short version)

- **Bluetooth:** BLE service `FF00`, write characteristic `FF02`. The service is not advertised, so discover the printer by its name, `D30…`.
- **Print job:**
  ```
  1B 40  1D 76 30 00  0C 00 40 01  <3840 bytes>  1B 64 00
  ```
  - `1B 40`: initialise the printer.
  - `1D 76 30 00`: raster image command.
  - `0C 00 40 01`: 12 bytes per row × 320 rows, little-endian.
  - `<3840 bytes>`: the bitmap, with the most significant bit leftmost and 1 = black.
  - `1B 64 00`: finish and feed to the label gap.
- **Image:** the label is designed at 320×96, landscape, then rotated 90° clockwise before sending.
- **Sending:** write in chunks of 128 bytes or less, with write-with-response.

See the design doc for sources and details.
