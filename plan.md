# Outfit — Implementation Plan

Spec: `idea.md`. Stack is fixed: Expo + TypeScript + Expo Router (tabs), runs in **Expo Go only** (no dev client, no custom native modules), Open-Meteo, Claude `claude-sonnet-5` behind a key-holding proxy, on-device storage only.

Five milestones, in spec order. Each ends with a **STOP — test on phone** checkpoint. Nothing in a later milestone starts until the checklist for the current one passes.

---

## Decisions made

| Topic | Choice | Why |
|---|---|---|
| Data storage | `@react-native-async-storage/async-storage`, one JSON blob per key (`closet`, `plans`, `settings`, `forecast`, `dressCodes`) | Data is tiny (tens of items, 7 plans). No queries, no migrations. Bundled in Expo Go. `expo-sqlite` is overkill here. |
| Photo storage | `expo-file-system`, `documentDirectory/closet/<id>.jpg` | Picker URIs are temporary; copy into app documents so they survive restarts. |
| Image handling | `expo-image-picker` (camera + library, `allowsMultipleSelection`) → `expo-image-manipulator` resize to **1024px long edge, JPEG q=0.7** → save → read base64 for tagging | Keeps each `/tag` payload ~150–300 KB. Faster upload, cheaper tokens, avoids Expo Go memory pressure with multi-select. Only the resized copy is stored. |
| Proxy host | **Cloudflare Worker** in `proxy/`, official `@anthropic-ai/sdk` (fetch-based, runs on Workers) | Single file, free tier, `wrangler secret put ANTHROPIC_API_KEY`. Key never touches app code or `EXPO_PUBLIC_*`. |
| Proxy abuse guard | Worker requires `Authorization: Bearer <APP_TOKEN>`; token is a Worker secret and `EXPO_PUBLIC_APP_TOKEN` in the app | Not real security (it ships in the JS bundle) but stops drive-by scanners from spending your Claude credit. Cheap. |
| Proxy URL in app | `EXPO_PUBLIC_PROXY_URL` in `.env` | Not a secret. |
| Closet item IDs | `Crypto.randomUUID()` from `expo-crypto`, generated in the app when a photo is added | Stable, unguessable, no counter to persist. |
| AI-referenced IDs | Model gets `{id, tags}` per item and returns `item_ids[]`. App builds `Set<string>` of closet IDs and rejects any plan day containing an unknown or duplicate ID → counts as invalid → retry once. Rendering also filters through the closet map, so a missing ID can never crash the collage. | Spec: "check this in code". |
| Strict JSON | Structured outputs: `client.messages.parse({ output_config: { format: zodOutputFormat(Schema) } })`; `parsed_output === null` → Worker returns 502 `invalid_output` → app treats as invalid → retries once | Guarantees shape at the API level; rules/IDs validated in app. No prefill (removed on Sonnet 5). |
| Retry semantics | Exactly **one** retry per plan request, done by the app. Retry body includes `violations: string[]` which the Worker appends to the user message. | Spec says retry once. Worker itself never retries, so worst case is 2 model calls. |
| Dress code per day | Each day card has a chip row `None · Casual · Smart · Formal`. Selection is stored in `dressCodes: Record<date, Formality>` (separate from plans so it survives regeneration). Changing it marks the card "needs regenerate"; it does not auto-call the AI. Passed to the planner and enforced in app validation. | Spec: "choose if they need to address dress code for each day." |
| Weather | `GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7` — always Celsius; convert to °F for display only. Cached 3 h. | No key. Rules run in °C regardless of display unit. |
| Location override | Free-text city in Settings, resolved via `GET https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=1` → stored as `{name, latitude, longitude}` | No key. Falls back to `expo-location` when null. |
| Week range | Today + next 6 days, dates as `YYYY-MM-DD` in the phone's local timezone | Matches Open-Meteo `timezone=auto`. |
| State sharing | One React context (`AppStateProvider`) that loads from AsyncStorage on mount and writes through on change | Three tabs need the same closet/plans/settings. Smallest thing that works. |

---

## Folder tree

```
outfit/
  app/
    _layout.tsx               # Root stack, wraps AppStateProvider
    (tabs)/
      _layout.tsx             # Tabs: Closet, Week, Settings
      index.tsx               # Closet
      week.tsx                # Week
      settings.tsx            # Settings
    item/[id].tsx             # Item detail (modal): photo, tags editor, delete
  src/
    types.ts
    store.tsx                 # AppStateProvider + useAppState()
    storage.ts                # AsyncStorage get/set per key
    photos.ts                 # pick, resize, save, delete, readBase64
    api.ts                    # fetch wrapper for proxy (/tag, /plan)
    weather.ts                # Open-Meteo fetch + WMO code → icon/label
    location.ts               # expo-location + geocoding
    planner.ts                # plan → validate → retry once → persist
    validatePlan.ts           # outfit rules (pure functions)
    components/
      ClosetGrid.tsx
      ItemCard.tsx
      TagEditor.tsx
      DayCard.tsx
      OutfitCollage.tsx
      EmptyState.tsx
      ErrorBanner.tsx
  proxy/
    src/index.ts              # Worker: routing, auth, error mapping
    src/schemas.ts            # zod schemas (ItemTags, PlanResponse)
    src/prompts.ts            # TAG_SYSTEM, PLAN_SYSTEM
    wrangler.toml
    package.json
    tsconfig.json
  .env                        # EXPO_PUBLIC_PROXY_URL, EXPO_PUBLIC_APP_TOKEN (gitignored)
  .env.example
  app.json
  package.json
  tsconfig.json
  README.md
```

---

## Data model (`src/types.ts`)

```ts
export type Category = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'dress' | 'accessory';
export type Formality = 'casual' | 'smart' | 'formal';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface ItemTags {
  category: Category;
  color: string;
  warmth: 1 | 2 | 3 | 4 | 5;
  formality: Formality;
  rainproof: boolean;
  season: Season[];          // one or more; all four = year-round
}

export interface ClosetItem {
  id: string;                // uuid
  photoUri: string;          // file:// in documentDirectory/closet/
  createdAt: string;         // ISO
  tags: ItemTags | null;
  tagStatus: 'pending' | 'tagging' | 'tagged' | 'failed';
}

export interface DayForecast {
  date: string;              // YYYY-MM-DD
  tMaxC: number;
  tMinC: number;
  rainChance: number;        // 0–100
  weatherCode: number;       // WMO
}

export interface Forecast {
  fetchedAt: string;
  latitude: number;
  longitude: number;
  locationName: string;
  days: DayForecast[];       // 7
}

export interface DayPlan {
  date: string;
  itemIds: string[];
  reason: string;
  generatedAt: string;
  status: 'ok' | 'failed';   // failed = AI/validation failed twice; card shows error + Regenerate
}

export interface Settings {
  unit: 'C' | 'F';
  stylePreference: string;
  locationOverride: { name: string; latitude: number; longitude: number } | null;
}

export type DressCodes = Record<string /* date */, Formality>;
```

---

## Proxy API

Both endpoints: `Content-Type: application/json`, `Authorization: Bearer <APP_TOKEN>`. Errors always `{ error: string, message?: string }`.

### `POST /tag`

Request:
```json
{ "image": "<base64 jpeg, no newlines>", "mediaType": "image/jpeg" }
```
Response `200`:
```json
{ "tags": { "category": "top", "color": "navy", "warmth": 2, "formality": "smart", "rainproof": false, "season": ["spring", "autumn"] } }
```
Errors: `401 unauthorized`, `400 bad_request`, `429 rate_limited`, `502 invalid_output` (parsed_output null), `502 upstream`, `503 connection`.

### `POST /plan`

Request:
```json
{
  "items": [{ "id": "…", "tags": { /* ItemTags */ } }],
  "forecast": [{ "date": "2026-09-26", "tMaxC": 18, "tMinC": 11, "rainChance": 70, "weatherCode": 61 }],
  "days": ["2026-09-26"],
  "otherDays": [{ "date": "2026-09-25", "itemIds": ["…"] }],
  "dressCodes": { "2026-09-26": "smart" },
  "stylePreference": "minimal, no bright colors",
  "violations": []
}
```
- `days`: dates to plan (7 for whole week, 1 for single-day regenerate).
- `otherDays`: existing plans for the remaining days, so the model avoids repeating yesterday's/tomorrow's top and spreads items. Empty for full-week.
- `violations`: empty on first attempt; app-generated strings on retry, e.g. `"2026-09-26: item abc123 is not in the closet"`.

Response `200`:
```json
{ "days": [{ "date": "2026-09-26", "item_ids": ["…", "…"], "reason": "Rain likely — waterproof shell over the grey knit." }] }
```
Same error set as `/tag`.

### Worker implementation notes (verified against current API — do not swap from memory)

- `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`. Key from `wrangler secret put ANTHROPIC_API_KEY`.
- Model `claude-sonnet-5` exactly. No date suffix.
- Both calls: `client.messages.parse({...})` with `output_config: { effort, format: zodOutputFormat(Schema) }`; `zod` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. Read `response.parsed_output`; if `null` → `502 invalid_output`. The top-level `output_format` param is deprecated — use `output_config.format`.
- `thinking: { type: 'adaptive' }` is the only on-mode on Sonnet 5. **Do not** send `budget_tokens`, `temperature`, `top_p`, `top_k` (all 400). Effort: `low` for `/tag`, `medium` for `/plan`.
- `max_tokens: 16000` (non-streaming default; don't lowball).
- No assistant prefill (400 on Sonnet 5). No `{role: "system"}` inside `messages[]` (unsupported on Sonnet 5) — system prompt goes in top-level `system`.
- Vision block shape, placed **before** the text block:
  ```ts
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
  { type: 'text', text: 'Tag this clothing item.' }
  ```
- Error chain, most specific first:
  ```ts
  catch (e) {
    if (e instanceof Anthropic.RateLimitError)    return json(429, { error: 'rate_limited' });
    if (e instanceof Anthropic.APIStatusError)    return json(502, { error: 'upstream', message: `${e.status}` });
    if (e instanceof Anthropic.APIConnectionError) return json(503, { error: 'connection' });
    throw e;
  }
  ```
- Nice to have (not blocking): `PLAN_SYSTEM` is stable, so put it in a `system` array block with `cache_control: { type: 'ephemeral' }`; keep all per-request content (items, forecast, violations) in the user message after it. Max 4 breakpoints; prefix-match, so volatile stuff last.

Zod schemas (`proxy/src/schemas.ts`):
```ts
export const ItemTagsSchema = z.object({
  category: z.enum(['top','bottom','outerwear','shoes','dress','accessory']),
  color: z.string(),
  warmth: z.number().int().min(1).max(5),
  formality: z.enum(['casual','smart','formal']),
  rainproof: z.boolean(),
  season: z.array(z.enum(['spring','summer','autumn','winter'])).min(1),
});
export const PlanSchema = z.object({
  days: z.array(z.object({
    date: z.string(),
    item_ids: z.array(z.string()),
    reason: z.string(),
  })),
});
```

---

## Outfit-rule validation (`src/validatePlan.ts`, runs in app after `/plan` returns)

Input: response days, closet map, forecast, dressCodes, plus neighbor plans (`otherDays`) for single-day regen. Output: `{ ok: boolean; violations: string[]; warnings: string[] }`. Hard violations trigger the single retry; warnings are sent along on retry but do not fail the second attempt.

Hard rules:
1. **Real IDs** — every `item_ids` entry exists in the closet and is tagged; no duplicates within a day; every requested date is present exactly once.
2. **Composition** — a day has `shoes` and either a `dress` or (`top` + `bottom`). (Skipped for any category the closet doesn't contain, e.g. no shoes yet.)
3. **Cold → outerwear** — if `tMaxC < 12` the day includes an `outerwear` item. Skipped if the closet has no outerwear.
4. **Rain → rainproof** — if `rainChance > 50` the day includes at least one `rainproof: true` item. Skipped if the closet has none.
5. **No repeated top** — the same `top` (or `dress`) ID does not appear on two consecutive dates (checks against `otherDays` neighbors too).
6. **Dress code** — if `dressCodes[date]` is set, every `top`/`bottom`/`dress`/`outerwear` item has formality ≥ requested (`casual < smart < formal`).

Warnings (soft):
7. **Warmth band** — mean warmth of `top`/`dress`/`outerwear` items vs `tMaxC`: `≥25 → ≤2`, `15–24 → 2–3`, `5–14 → ≥3`, `<5 → ≥4`.
8. **Spread** — any `top`/`bottom`/`dress` used on more than 3 of the 7 days.

Whenever a rule is skipped because the closet lacks the category, `planner.ts` adds a line to the user message so the model knows (e.g. "Closet has no rainproof items; do your best.").

Flow in `planner.ts`:
```
plan(days) → POST /plan → validate
  ok           → persist DayPlans (status 'ok')
  not ok / 502 → POST /plan again with violations+warnings → validate
     ok        → persist
     not ok    → persist DayPlan {status:'failed', reason: first violation}; card shows error + Regenerate
```

---

## Milestone 1 — Scaffold + tabs in Expo Go

**Goal:** Three empty tabs running on the phone via Expo Go.

**Files**
- `npx create-expo-app@latest . --template default` (ships Expo Router + tabs + TS). Delete demo components/hooks/assets it adds (`components/*`, `hooks/*`, `constants/*` except what `(tabs)/_layout.tsx` needs, `app/(tabs)/explore.tsx`, `app/modal.tsx` if present).
- `app/_layout.tsx` — Stack: `(tabs)` + `item/[id]` (presentation `modal`).
- `app/(tabs)/_layout.tsx` — three tabs, SF Symbols / Ionicons icons.
- `app/(tabs)/index.tsx`, `week.tsx`, `settings.tsx` — placeholder screens with titles.
- `app/item/[id].tsx` — placeholder.
- `src/types.ts` — full model above.
- `app.json` — `name: "Outfit"`, `scheme: "outfit"`, `ios.infoPlist` usage strings for camera, photo library, location (harmless in Expo Go, needed later).
- `.env.example`, `.gitignore` (add `.env`).
- `README.md` — skeleton headings only (filled in M3/M5).

**Notes**
- Keep the template's light/dark theme support; drop everything else.
- `npx expo start` → scan QR with Camera app → opens in Expo Go. Use `--tunnel` if phone and Mac are on different networks.

**STOP — test on phone**
- [ ] App opens in Expo Go without red screen.
- [ ] Three tabs visible: Closet, Week, Settings; tapping switches screens.
- [ ] Rotating / backgrounding / reopening keeps state.
- [ ] Shake → Reload works.

---

## Milestone 2 — Closet: add / view / delete photos (no AI)

**Goal:** Photos persist on device across app restarts; grid, detail modal, delete.

**Files**
- `src/storage.ts` — `load<T>(key)`, `save(key, value)` over AsyncStorage.
- `src/store.tsx` — `AppStateProvider` (closet, plans, settings, forecast, dressCodes; `hydrated` flag) + actions `addItems`, `updateItem`, `removeItem`, `setSettings`, ….
- `src/photos.ts` — `pickFromLibrary()`, `pickFromCamera()`, `importAsset(uri) → {id, photoUri}` (resize 1024/q0.7 → copy to `documentDirectory/closet/<id>.jpg`), `deletePhoto(uri)`, `readBase64(uri)`.
- `src/components/ClosetGrid.tsx` (FlatList, 3 columns), `ItemCard.tsx` (expo-image thumbnail + status badge), `EmptyState.tsx`.
- `app/(tabs)/index.tsx` — grid + "Add" (ActionSheet: Camera / Library).
- `app/item/[id].tsx` — full photo + Delete (confirm alert).
- `app/_layout.tsx` — wrap in `AppStateProvider`; render nothing until `hydrated`.

**Installs:** `npx expo install @react-native-async-storage/async-storage expo-file-system expo-image-picker expo-image-manipulator expo-image expo-crypto`.

**Notes**
- Multi-select from library imports sequentially with a progress count ("Importing 3/8…"); items appear in grid as each lands, `tagStatus: 'pending'`.
- Camera returns one photo per shot; loop "Take another?" is out of scope — one at a time is fine.
- Delete removes the file, the closet entry, and strips the ID from any existing `DayPlan.itemIds`.
- Create the `closet/` directory on first import (`makeDirectoryAsync` with `intermediates`). On hydrate, drop closet entries whose file no longer exists.

**STOP — test on phone**
- [ ] Add from library (single + multi-select 5+) — all appear in grid.
- [ ] Add from camera — permission prompt appears once, photo appears.
- [ ] Deny permission → friendly alert, no crash.
- [ ] Kill app fully, reopen — photos still there.
- [ ] Tap item → modal with full photo; Delete → confirm → gone from grid and after restart.
- [ ] Add 20+ items — grid scrolls smoothly.

---

## Milestone 3 — Proxy + AI tagging

**Goal:** Every new photo gets tags from Claude; user can view/edit tags; failures are retryable.

**Files**
- `proxy/wrangler.toml`, `proxy/package.json` (`@anthropic-ai/sdk`, `zod`, `wrangler`, `typescript`), `proxy/tsconfig.json`.
- `proxy/src/index.ts` — router (`/tag`, `/plan`), bearer check, CORS not needed (native fetch), error chain above. `/plan` handler can land here now or in M4 — write it here, exercise it in M4.
- `proxy/src/schemas.ts`, `proxy/src/prompts.ts`.
- `src/api.ts` — `tagImage(base64)`, `planDays(body)`; maps HTTP errors → `ApiError { code }`.
- `src/components/TagEditor.tsx` — pickers for category/formality/season, 1–5 warmth stepper, rainproof switch, color text.
- `app/item/[id].tsx` — show tags, `TagEditor`, "Retag" button.
- `app/(tabs)/index.tsx` — after import, kick off tagging queue; badge on card: pending/tagging/tagged/failed.
- `src/store.tsx` — `tagItem(id)` action.
- `README.md` — fill in proxy deploy + secrets steps.

**Notes**
- `TAG_SYSTEM`: "You tag one clothing item from a photo. Return category, dominant color (one or two words), warmth 1 (very light) – 5 (very warm), formality, rainproof, seasons it suits." Structured output handles the shape.
- Tagging queue: sequential (one in flight) to avoid rate limits and Expo Go memory spikes. Failed items stay `failed` with a Retag button; no auto-retry for tagging (that's the plan endpoint's rule).
- `readBase64` must produce a single-line base64 string (expo-file-system does this).
- Deploy: `cd proxy && npm i && npx wrangler login && npx wrangler secret put ANTHROPIC_API_KEY && npx wrangler secret put APP_TOKEN && npx wrangler deploy`. Copy the `*.workers.dev` URL into `.env`. Restart `expo start` after editing `.env`.
- Test the Worker from the Mac first with `curl` before touching the app.

**STOP — test on phone**
- [ ] `curl -X POST $URL/tag` with a real base64 image → tags JSON. Wrong/missing token → 401.
- [ ] Add a photo → badge goes pending → tagging → tagged within ~10 s; open item → tags look plausible.
- [ ] Add 5 at once → they tag one after another; UI stays responsive.
- [ ] Edit a tag (e.g. warmth 2 → 4), close, reopen, restart app → edit persisted.
- [ ] Turn on Airplane Mode, add a photo → badge `failed`, clear message; turn off, Retag → tagged.
- [ ] Temporarily set a wrong `EXPO_PUBLIC_APP_TOKEN` → "Proxy rejected request" style error, not a crash.

---

## Milestone 4 — Weather + Week screen + AI outfit planning

**Goal:** Seven day cards with forecast and validated AI outfits; per-day and whole-week regenerate; dress code chips.

**Files**
- `src/location.ts` — `resolveLocation(settings)`: override → else `expo-location` (`requestForegroundPermissionsAsync`, `getCurrentPositionAsync`); `geocode(query)`.
- `src/weather.ts` — `fetchForecast(lat, lon)` → `Forecast`; `wmoToIcon(code)` (Ionicons name + label); `toDisplayTemp(c, unit)`.
- `src/validatePlan.ts`, `src/planner.ts` — as specified above.
- `src/components/DayCard.tsx` — date, icon, hi/lo, rain %, dress-code chips, `OutfitCollage`, reason line, Regenerate button, loading/failed states.
- `src/components/OutfitCollage.tsx` — 2×2 (or 2×3) grid of item thumbnails from `itemIds` filtered through the closet map.
- `app/(tabs)/week.tsx` — header "Plan week" button, location name, FlatList of 7 `DayCard`s; refetch forecast on focus if > 3 h old.
- `app/(tabs)/settings.tsx` — unit segmented control, style preference `TextInput` (multiline), location override input + "Use current location" reset.
- `src/store.tsx` — `plans`, `forecast`, `dressCodes` actions.
- `proxy/src/prompts.ts` — `PLAN_SYSTEM`: rules verbatim from spec + "use only provided IDs" + "one-line reason" + honor `dressCodes` and `stylePreference` + treat `violations` as corrections.

**Installs:** `npx expo install expo-location`.

**Notes**
- Whole-week: `days` = 7 dates, `otherDays` empty. Single day: `days` = [date], `otherDays` = the other 6 current plans (so neighbors are respected).
- Only send tagged items to `/plan`. If fewer than ~4 tagged items, show an empty state instead of calling the AI.
- Dress code chip change: store in `dressCodes`, mark that card "needs regenerate" (subtle label); user taps Regenerate.
- Forecast failure (offline / no location) → Week shows an `ErrorBanner` with Retry and a link to Settings for location override; plans from before still render.
- Deleting a closet item strips it from plans (done in M2); a day left with < 2 items shows "Regenerate".

**STOP — test on phone**
- [ ] First open of Week → location prompt → 7 cards with icon, hi/lo, rain %, city name.
- [ ] Switch unit C ↔ F in Settings → Week temps update immediately.
- [ ] Set location override "Tokyo" → forecast changes to Tokyo; clear it → back to GPS.
- [ ] "Plan week" → cards show spinners → outfits appear as collages of *your* photos, each with a one-line reason.
- [ ] No day repeats yesterday's top; rainy day (>50 %) includes a rainproof item if you own one; cold day includes outerwear if you own one.
- [ ] Set a day's dress code to Formal → Regenerate that day → only formal-or-better main pieces.
- [ ] Regenerate a single day → only that card changes.
- [ ] Airplane Mode → Plan week → clear error, cards keep last plan; Retry works after reconnecting.
- [ ] Delete a closet item used in a plan → collage no longer shows it, no crash.
- [ ] Kill app, reopen → plans and forecast still present.

---

## Milestone 5 — Polish: loading, errors, empty states, UI

**Goal:** Every screen has a clear state for empty / loading / error; visual pass.

**Files (changed)**
- `src/components/EmptyState.tsx`, `ErrorBanner.tsx` — finalized and used everywhere.
- `app/(tabs)/index.tsx` — empty closet ("Add your first item"), import progress bar, tag status badges polished, long-press → delete shortcut.
- `app/(tabs)/week.tsx` — states: no closet items / not enough tagged / no location / offline / planning; pull-to-refresh refetches forecast; skeleton cards while planning; disable buttons while a request is in flight.
- `app/item/[id].tsx` — save feedback; retag spinner.
- `app/(tabs)/settings.tsx` — geocoding "not found" state; show resolved city.
- `src/api.ts` — user-facing messages per error code (`rate_limited` → "AI is busy, try again in a minute", `unauthorized` → "Proxy token mismatch", `connection`/network → "You're offline").
- Consistent spacing/typography constants in one small `src/theme.ts`; respect system dark mode.
- `README.md` — finalize.

**STOP — test on phone**
- [ ] Fresh install (delete app data via "Clear" in Expo Go or reinstall): Closet, Week, Settings each show a sensible empty state with a next step.
- [ ] Every network action shows a spinner and disables its button while in flight.
- [ ] Every failure path (offline, 429, 502, bad token, geocode miss) shows a readable message with a retry.
- [ ] Dark mode looks fine.
- [ ] Nothing in the UI references an item that no longer exists.
- [ ] Full flow end-to-end: add 10 items → tags → plan week → tweak a dress code → regenerate day → restart app → all still there.

---

## README outline (`README.md`)

1. What it is (2 lines) + screenshot placeholders
2. Requirements — Node LTS, Expo Go on iPhone, Cloudflare account, Anthropic API key
3. Install — `npm install`, copy `.env.example` → `.env`
4. Deploy the proxy — `cd proxy && npm i && npx wrangler login && npx wrangler secret put ANTHROPIC_API_KEY && npx wrangler secret put APP_TOKEN && npx wrangler deploy`; copy URL
5. Configure the app — `EXPO_PUBLIC_PROXY_URL`, `EXPO_PUBLIC_APP_TOKEN`
6. Run on the phone — `npx expo start` (`--tunnel` if needed), scan QR with Camera → Expo Go
7. Using the app — add clothes, wait for tags, open Week, set dress codes, regenerate
8. How it works — data model, storage locations, proxy endpoints, validation rules (short)
9. Costs — rough per-tag / per-plan token estimate at $2/$10 per MTok
10. Troubleshooting — `.env` changes need restart; permission denied; Worker 401; location override
11. Not in scope — accounts, cloud sync, App Store build
