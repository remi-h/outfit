# Outfit

## What it is

Photograph your clothes, and Claude tags each item and plans an outfit for every day
of the coming week against the real forecast where you are. Everything lives on your
phone; the only thing in the cloud is a tiny proxy that holds the API key.



## Requirements

- **Node LTS** (20 or newer) and npm.
- **An iPhone with [Expo Go](https://apps.apple.com/app/expo-go/id982107779)** installed.
  There is no dev client and no custom native code, so no Apple Developer account is needed.
- **A Cloudflare account** (the free Workers plan is plenty) for the proxy.
- **An Anthropic API key** from [console.anthropic.com](https://console.anthropic.com).
  The key only ever lives in Cloudflare — never in the app, never in a `.env`, never in git.

No key is needed for the weather: Open-Meteo is free and unauthenticated.

## Install

```bash
git clone <this repo> outfit
cd outfit
npm install
cp .env.example .env
```

Leave `.env` blank for now — you fill it in after the proxy is deployed.

## Deploy the proxy

The proxy is a single Cloudflare Worker in `proxy/`. It exposes `POST /tag` and
`POST /plan`, and it is the only thing that ever sees your Anthropic API key.

```bash
cd proxy
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # paste your sk-ant-... key at the prompt
npx wrangler secret put APP_TOKEN           # paste a long random string (see below)
npx wrangler deploy
```

Generate the `APP_TOKEN` first and keep it somewhere you can paste it twice:

```bash
openssl rand -hex 24
```

`wrangler deploy` prints the URL, e.g. `https://outfit-proxy.<your-subdomain>.workers.dev`.
Copy it — that is `EXPO_PUBLIC_PROXY_URL`.

Check it before touching the app. A request with no token must be rejected:

```bash
URL=https://outfit-proxy.<your-subdomain>.workers.dev
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/tag"
# 401

curl -s -X POST "$URL/tag" \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"image\":\"$(base64 < some-shirt.jpg | tr -d '\n')\",\"mediaType\":\"image/jpeg\"}"
# {"tags":{"category":"top","color":"navy","warmth":2,...}}
```

To iterate on the Worker locally, copy `proxy/.dev.vars.example` to `proxy/.dev.vars`
(gitignored) and run `npx wrangler dev`. `.dev.vars` is for local development only —
in production both values are Worker secrets, set with `wrangler secret put`.

## Configure the app

Put the two values in `.env` at the repo root:

```dotenv
EXPO_PUBLIC_PROXY_URL=https://outfit-proxy.<your-subdomain>.workers.dev
EXPO_PUBLIC_APP_TOKEN=<the same random string you gave wrangler secret put APP_TOKEN>
```

Both are `EXPO_PUBLIC_*`, which means they are baked into the JS bundle. That is fine
for the URL. For the token, see the honest note in **How it works** below: it is an
abuse guard, not a secret.

`.env` is gitignored. **Expo only reads `.env` at startup — restart `npx expo start`
after any change.**

## Run on the phone

```bash
npx expo start
```

Scan the QR code with the iPhone Camera app; it opens in Expo Go. If your Mac and
phone are on different networks (or the office Wi-Fi blocks peer traffic), use:

```bash
npx expo start --tunnel
```

Shake the phone for the dev menu (Reload, etc.).

## Using the app

1. **Closet** — tap **Add** and pick Camera or Photo Library. Multi-select works;
   photos import one at a time with a progress count. Each new item shows a badge:
   `pending` → `tagging` → `tagged`, usually within about ten seconds.
2. Tap an item to see the photo and its tags. Edit anything that looks wrong —
   category, colour, warmth 1–5, formality, rainproof, seasons — or hit **Retag**
   to ask Claude again. Edits are saved on the device and are never overwritten.
3. **Settings** — pick °C or °F, type a style preference in plain English
   ("minimal, no bright colours"), and optionally override your location with a
   city name.
4. **Week** — the first visit asks for location permission, then shows seven day
   cards with icon, high/low and rain chance. Tap **Plan week**.
5. Each card gets a collage of your own photos and a one-line reason. Set a
   **dress code** chip (None / Casual / Smart / Formal) on any day and tap that
   card's **Regenerate** — only that day changes, and it still respects its
   neighbours so you don't wear the same top twice running.

Tag at least four or five items before planning; below that the Week tab just tells
you to add more clothes rather than asking the AI for something impossible.

## How it works

**Data model.** Every closet item is `{ id, photoUri, createdAt, tags, tagStatus }`,
where `tags` is `{ category, color, warmth 1-5, formality, rainproof, season[] }`.
A day plan is `{ date, itemIds[], reason, generatedAt, status }`. IDs are UUIDs
generated on the phone with `expo-crypto`.

**Storage locations.** Photos are resized to a 1024 px long edge at JPEG quality 0.7
and copied into `documentDirectory/closet/<id>.jpg` (`expo-file-system`); picker URIs
are temporary, so the copy is what survives a restart. Everything else is one JSON
blob per key in AsyncStorage: `closet`, `plans`, `settings`, `forecast`, `dressCodes`.
There is no account, no server-side database, and nothing syncs.

**Weather.** Open-Meteo, no key, cached for three hours. Rules always run in Celsius;
°F is a display conversion only.

**Proxy endpoints.** Both require `Authorization: Bearer <APP_TOKEN>` and return
`{ error, message? }` on failure.

| | `POST /tag` | `POST /plan` |
| --- | --- | --- |
| Request | `{ image, mediaType }` | `{ items, forecast, days, otherDays, dressCodes, stylePreference, violations }` |
| Response | `{ tags }` | `{ days: [{ date, item_ids, reason }] }` |
| Errors | `401 unauthorized`, `400 bad_request`, `429 rate_limited`, `502 invalid_output`, `502 upstream`, `503 connection` | same |

Both call `claude-sonnet-5` with adaptive thinking and a structured-output schema, so
the JSON shape is guaranteed at the API level. **The Worker never retries** — the app
owns the single retry, so one tap is at most two model calls.

**Validation.** Shape comes from the API; the rules are checked on the phone, because
that is where the closet actually lives. After `/plan` returns, the app checks: every
`item_ids` entry is a real, tagged, non-duplicated closet ID and every requested date
appears exactly once; each day has shoes plus a dress or a top-and-bottom; below 12 °C
there is outerwear; above 50 % rain chance there is something rainproof; no top or
dress repeats on consecutive days; and any dress code is met. Warmth-vs-temperature
banding and over-use of one garment are warnings, not failures. Rules whose category
your closet doesn't contain are skipped and the model is told so. A failure sends the
violations back for one retry; a second failure marks the card failed with a
**Regenerate** button. Rendering also filters through the closet map, so a stale ID
can never crash a collage.

**About `APP_TOKEN`.** It is an abuse guard, not security. `EXPO_PUBLIC_APP_TOKEN`
ships inside the JavaScript bundle, so anyone who can read your app's bundle can read
the token. It exists to stop a drive-by scanner that finds your `workers.dev` URL from
spending your Claude credit — nothing more. If it ever leaks, rotate it:
`npx wrangler secret put APP_TOKEN`, update `.env`, restart Expo. Real protection
would need accounts and per-user auth, which is explicitly out of scope.

## Costs

Claude Sonnet 5 is **$2 per million input tokens and $10 per million output tokens**.
Open-Meteo, Expo Go and the Cloudflare Workers free tier cost nothing.

**Tagging one photo (`/tag`, effort `low`).** A 1024 px JPEG is roughly 1,100–1,600
image tokens; the system prompt adds about 150. Output is a small JSON object plus a
little adaptive thinking, call it 300 tokens.

> ≈ 1,700 in × $2/M + 300 out × $10/M ≈ **$0.006 per photo** — a 40-item closet costs
> about **$0.25** to tag, once.

**Planning a week (`/plan`, effort `medium`).** Input is the system prompt (~700
tokens) plus your whole tagged closet and the forecast as JSON — about 3,500–4,000
tokens for a 40-item closet. Output is seven days of IDs and reasons plus rather more
thinking, call it 3,000 tokens.

> ≈ 4,000 in × $2/M + 3,000 out × $10/M ≈ **$0.04 per week plan**. A single-day
> regenerate is roughly a fifth of that. Worst case, one invalid plan triggers the
> single retry and doubles it to about **$0.08**.

Planning every week for a year is on the order of **$2**. The dominant cost is
tagging, and you only pay it once per garment.

The `/plan` system prompt carries a `cache_control` breakpoint, but at ~700 tokens it
sits under Sonnet's minimum cacheable prefix, so today it is a no-op that costs
nothing and starts paying off if the prompt grows.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Changed `.env`, nothing happened | Expo reads `.env` only at startup. Stop and re-run `npx expo start`. |
| "Proxy token mismatch" / 401 from the Worker | `EXPO_PUBLIC_APP_TOKEN` ≠ the `APP_TOKEN` secret. Re-run `npx wrangler secret put APP_TOKEN`, paste the same value into `.env`, restart Expo. |
| Every tag fails with a 502 `upstream` | Usually a bad or unfunded `ANTHROPIC_API_KEY`. `npx wrangler secret put ANTHROPIC_API_KEY` again, then `npx wrangler tail` while you retry to see the status code. |
| `rate_limited` / "AI is busy" | 429 from Anthropic. Wait a minute; tagging is sequential by design so this is rare. |
| Badge stuck on `failed` | Usually offline. Reconnect and tap **Retag**; there is no auto-retry for tagging. |
| Camera or Photos permission denied | Settings → Expo Go → enable Camera / Photos, then reopen the app. |
| Week says it can't find your location | Location permission denied or indoors with no fix. Settings → type a city into the location override; "Use current location" clears it. |
| Location override finds the wrong city | Be more specific ("Cambridge, UK"). Geocoding takes the first match. |
| QR code opens but the app never loads | Phone and Mac on different networks — `npx expo start --tunnel`. |
| Outfits use items you deleted | They can't; the collage filters through the closet. A day left with fewer than two items shows **Regenerate**. |

`npx wrangler tail` from `proxy/` streams live Worker logs, which is the fastest way to
see which of the error codes above you are actually getting.

## Not in scope

No accounts, no login, no cloud sync or backup — delete the app and the closet goes with it. 
No Android testing.

## Coming soon
- App Store / TestFlight build 
- laundry tracking
- offline AI