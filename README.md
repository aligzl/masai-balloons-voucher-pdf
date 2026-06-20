# Masai Balloons — Voucher PDF Worker

Standalone Cloudflare Worker that renders the flight-voucher PDF (`pdf-lib` +
`@pdf-lib/fontkit`). It lives outside the main NuxtHub app so the main app's
Worker stays under Cloudflare's 3 MiB size limit.

The main app calls this Worker over HTTP with a shared secret; the Worker reads
the Noto fonts from the **same R2 bucket** the main app uses and returns the PDF.

## Contract

`POST /` with header `Authorization: Bearer <VOUCHER_SECRET>` and a JSON body:

```jsonc
{
  "referenceCode": "MB-XXXXXX",
  "name": "Jane Traveler",
  "zoneName": { "en": "North Mara", "tr": "Kuzey Mara" }, // or null
  "zoneSlug": "north-mara",
  "flightDate": "2026-07-01",
  "guests": 2,
  "passengerNames": ["Jane Traveler", "John Traveler"], // or null
  "hotel": "Mara Serena Lodge",                          // or null
  "wantsVideo": true,
  "videoPrice": 50,        // not shown on the voucher (we print "Included")
  "videoCurrency": "USD",
  "locale": "en",          // en | tr | de | fr | es | ch
  "brandName": "Masai Balloons"
}
```

Returns `application/pdf` bytes (200), or a plain-text error (401/400/422/500).

## Setup

```bash
npm install
npx wrangler login            # once, if not already
```

1. **R2 bucket name** — open Cloudflare dashboard → R2, find the bucket the
   NuxtHub main app uses (named after the project), and put it in
   `wrangler.toml` → `[[r2_buckets]].bucket_name`.

2. **Fonts** — make sure the fonts exist in that bucket at the flat keys
   `NotoSans-Regular.ttf` and `NotoSansSC-Regular.ttf`. The main app seeds them
   via `GET /api/admin/fonts-seed` (visit once while logged in as admin).

3. **Secret** — pick a long random string and set it both here and on the main
   app:
   ```bash
   wrangler secret put VOUCHER_SECRET     # paste the value
   ```
   Use the same value for the main app's `NUXT_VOUCHER_WORKER_SECRET` env var.

4. **Deploy**
   ```bash
   npm run deploy
   ```
   Note the deployed URL (e.g. `https://masai-balloons-voucher-pdf.<account>.workers.dev`)
   and set it as the main app's `NUXT_VOUCHER_WORKER_URL` env var.

## Local dev

```bash
echo "VOUCHER_SECRET=dev-secret" > .dev.vars
npm run dev   # serves on http://localhost:8787 (needs R2 access / --remote)
```

## Updating the voucher design / copy

Edit `src/voucher.ts` (layout + the 6-locale `VOUCHER_COPY`) and re-run
`npm run deploy`. Keep the terms/copy in sync with any product changes.
