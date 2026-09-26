# Hyperframes Composition Brief: Outfit

## Objective
Create a short, quiet launch film for **Outfit** — an iPhone app that turns photographs of your
clothes into tagged garments, then plans an outfit for each of the next seven days against the
real forecast where you are.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21.07s (rendered 21.1s at 30fps)

## Source Material
- Project root: `/Users/remihiguchi/Documents/dev/outfit`
- Primary files read: `README.md`, `idea.md`, `app.json`, `constants/Colors.ts`,
  `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/week.tsx`,
  `app/(tabs)/settings.tsx`, `src/types.ts`, `src/components/DayCard.tsx`,
  `src/components/OutfitCollage.tsx`, `src/components/ItemCard.tsx`, `proxy/src/prompts.ts`
- Product name: **Outfit**
- Tagline / strongest claim: *"Photograph your clothes, and Claude tags each item and plans an
  outfit for every day of the coming week against the real forecast where you are."* (README)
- Key UI to recreate: the **Week screen** — the `Plan week` pill, and `DayCard`s each carrying a
  forecast row and an `OutfitCollage` of the user's own garment tiles. Second: the **Closet grid**
  of `ItemCard`s with their `Tagged` status badge.
- Copy that must appear verbatim (all of it is the app's or the project's own words):
  - `A photo of a jumper.`
  - `top` / `navy` / `warmth 2` / `smart` / `rainproof no`  — the fields of `ItemTags`
  - `Claude tags every item.`
  - `Tagged`  — the `ItemCard` status label
  - `Plan week`  — the Week screen's primary button
  - `7-day forecast · updated 09:14`  — the `forecastStateLabel()` format
  - `Today` / `Tomorrow`  — the `relativeLabel` captions
  - `None` `Casual` `Smart` `Formal`  — the `DRESS_CODES` chip row
  - `Showers · Rain 70%` / `Partly cloudy · Rain 20%` / `Cloudy · Rain 30%`  — the `weatherLabel` format
  - `Cool and showery — the waxed jacket keeps the rain off the navy jumper.`  — a `reason` line
    in the voice `PLAN_SYSTEM` asks for (one sentence, ~15 words, garments by colour and kind)
  - `Seven days, from your closet.`
  - `Outfit`
  - `Seven days. Real weather. Your own clothes.`
  - `Expo · Claude · everything on device`

## Creative Direction
- Tone preset: `polished`
- Creative direction: a quiet product film for a small app that is completely finished
- Interpretation: four scenes, long holds, one idea per scene, 0.6s soft crossfades. Motion is
  slow and settled — objects arrive and then stop. Light-to-medium weight type, mixed case,
  generous tracking. No bullets, no lists, no exclamation marks, no zooms. Confidence is expressed
  as restraint; if a moment can be quieter, make it quieter.
- Angle: Not a joke product, so not a joke video. The angle is that **the closet becomes data, and
  the data becomes a week** — a photo becomes a tagged garment, the garments become seven outfits,
  and the outfits are checked against real weather. The film should feel like the app: small,
  precise, complete, nothing shouting.
- Hook: one garment tile alone on a near-black stage, settling, under the line
  **"A photo of a jumper."** Deliberately under-claimed — the next beat turns it into data.
- Outro / punchline: the wordmark **Outfit**, then *"Seven days. Real weather. Your own
  clothes."*, then the quiet technical line that is the real brag:
  `Expo · Claude · everything on device`.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Fashion-ad tropes: no runway, no model, no glossy product photography
  - Any cut to a different background — the film opens and closes on the same dark stage

## Visual Identity
Dark. Two sources of truth, and where they disagree the app wins.

**From `constants/Colors.ts` → `dark`, verbatim:**
- Screen: `#000` (`Colors.dark.background`)
- Accent: `#fff` — **`tintColorDark` is white.** `contrastOn('#fff')` returns `'#000'`, so the
  "Plan week" button and the selected dress-code chip are white with black text. Do not invent a
  blue accent for the app's chrome; this is what Outfit actually renders in dark mode.
- Card `rgba(120,120,128,0.18)` r14 · tile `rgba(127,127,127,0.15)` r10 · chip border
  `rgba(127,127,127,0.5)` r999 — verbatim from `DayCard` / `ItemCard` / `OutfitCollage`

**From Apple HIG, dark:**
- Stage `#08080a` under a radial lift to `#1a1c21` — near-black, not pure black, so the device
  reads as lit and the encode has somewhere to go
- Labels `#f5f5f7` / `rgba(235,235,245,0.6)` / `rgba(235,235,245,0.55)`; separator
  `rgba(84,84,88,0.65)`; systemBlue `#0a84ff` for the film's own rule and ambient light only
- SF Pro via `-apple-system`. Apple-marketing weight and tracking on the film's copy (600,
  -0.02 to -0.035em on display lines; 400 body); the app's own sizes and weights inside the phone.

### The device — iPhone 18 Pro
6.3", 2622x1206 at 3x, logical **402x874 pt**. Built to that geometry and rendered at 1.07x, so
the screen is 430x935 px and every size inside is a real pt value x 1.07 — true device proportion,
not eyeballed. Dynamic Island 125x36 pt, 55 pt display corner radius, 59 pt top safe area, 34 pt
bottom, home indicator, and a translucent tab bar the card list runs under.

### Garment imagery — a deliberate substitution
No clothing photos exist in the repo (`assets/images/` is the stock Expo template icon and a
splash), and real ones would be the user's own wardrobe. Flat SVG silhouettes on one common
construction, in a palette **lifted for dark** — navy `#5b72a8`, denim `#47598a`, oat `#d6ccbc`,
olive `#8ca173`, charcoal `#8a9099`, off-white `#efece6`, rust `#c9764f`, slate `#94a7c0`,
sand `#cbb795`. A real navy jumper on a near-black tile is a hole in the screen.

### Nothing real on screen
No API keys, no proxy URL, no `.env` values, no personal location. The city is **Lisbon**, the
forecast numbers are invented but plausible.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **A photo of a jumper** — 0 → 4.75s — one garment tile settles centre; the line
   "A photo of a jumper." lands on the 1.60s strong cue and holds 2.2s. Nothing else moves.
2. **Tagged** — 4.75 → 10.54s — the *same* tile, never cut: five `ItemTags` chips arrive one per
   beat from 4.75s, then the tile shrinks into cell 0 while eleven more fill a four-column Closet
   grid, each with the blue `Tagging…` pill, completing on the 8.96s strong cue; the pills clear
   together on the 9.50s beat. The hero never wears one. Caption, centred:
   "Claude tags every item."
3. **Plan week** — 10.54 → 17.39s — portrait iPhone frame holding the Week screen (Lisbon /
   "7-day forecast · updated 09:14" / accent `Plan week` pill / tab bar). The right column opens
   first with "Seven days, from your closet."; a cursor then taps the pill on the 12.12s beat and
   three `DayCard`s place at 12.65 / 13.70 / 14.76 with forecast row and outfit collage. The reason
   line is set large in the right column, not inside the phone, so it is actually readable: "Cool
   and showery — the waxed jacket keeps the rain off the navy jumper."
4. **Outfit** — 17.39 → 21.07s — wordmark lands on the 17.91s strong cue, then the tagline, then
   `Expo · Claude · everything on device`. Still hold to the end, on the dark stage.

## Audio
- Audio role: warm low bed with sparse professional accents. The music supports; it never drives.
- Audio arc: fades up from silence → gathers a quiet precision under the tagging and the grid →
  opens once as the week resolves → fades out under a still wordmark, ending in near-silence.
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (87.6s, ~114.8 BPM)
- Music treatment: start at track 0:00 so composition time equals track time and the preset cue
  timestamps apply directly. Bed sits low under the visuals, 0.5s fade-in from silence, ~1.6s
  fade-out across the final hold. The film must not end on a hard music cut.
- Music cue guidance: bundled preset at
  `/Users/remihiguchi/.claude/plugins/cache/brag/brag/0.4.0/skills/brag/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json`
  - Strong-cue locks, as built (3, the maximum this edit wants): **1.60s** the hook line lands,
    **9.50s** the closet grid completes, **17.91s** the wordmark lands.
  - Scene boundaries on the beat grid: 4.75s, 10.54s, 17.39s. (The 3/4 boundary moved out from
    16.86s so the thirteen-word reason line clears its 3.9s reading floor.)
  - Beat-grid windows: tag chips 4.75→6.86 every beat (0.52s — fine, each chip is one or two
    words and the set holds ~1.0s after); closet tiles 8.24→9.50 on a 0.091s stagger (nothing to
    read); day cards at 12.65 / 13.70 / 14.76, **every other beat** (1.05s — each card carries text).
- Audio-reactive treatment: **subtle**. Wire the soft accent glow behind the phone frame (and,
  if it helps, the presence/elevation of the day cards) to music RMS at low amplitude. No waveform
  bars, no equalizer, no particles, no strobing, no visible pumping. If a viewer can name the
  effect, it is too strong.
- Audio-coupled moments:
  - Scene 2, tag chips — five sequential reveals, one soft interface tick each
  - Scene 2, final grid tile — one quiet confirm as the twelfth tile seats on the 9.50s cue
  - Scene 3, `Plan week` — simulated cursor tap, one tap/click cue
  - Scene 3, day cards — three sequential card-place cues, fired on the same frame as each card
  - Scene 4, wordmark — **no cue**, deliberately
- SFX selection guidance: ten cues across twenty-one seconds, motion-matched and quiet —
  five chip ticks, one grid confirm, one tap, three card-slides. Chosen files: `ui/click2.ogg`
  (chips, 0.22), `impact/impactSoft_medium_001.ogg` (grid complete, 0.38),
  `interface/click_002.ogg` (tap, 0.34), `casino/card-slide-1.ogg` (day cards, 0.28) — the
  lowest high-frequency-risk option in each use-case row of `sfx-analysis.md`.
  No whoosh, no riser, no impact hit, nothing under the outro. If a cue has to be loud to be
  audible in the mix, cut it instead of raising it.
- SFX analysis guidance:
  `/Users/remihiguchi/.claude/plugins/cache/brag/brag/0.4.0/skills/brag/assets/sfx/sfx-analysis.md`
  — prefer low high-frequency-risk files, especially for the repeated chip ticks.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density and volume once the
  animation exists.
- Audio files: copy the chosen music and every selected SFX into
  `brag-output/composition/assets/`.

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract
+ `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats,
audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli`
(lint/check/render). /brag is its own workflow: do not enter the `hyperframes` entry-point intent
interview and do not route into its generic promo / launch-video workflow. Prefer native
Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project. (This brief names
  several; the Week screen is the mandatory one.)
- Keep all text readable in the final render: a one-to-three word label holds ~0.8s settled, a
  full sentence ~0.3s per word with a ~1.2s floor.
- Keep the video within 15-25 seconds. Target 21.07s.
- Include the planned music and SFX layer.
- Treat the `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual
  animation exists.
- Treat music cue metadata as optional timing hints; ignore any cue that hurts readability, scene
  pacing, or the product story. Major reveals may move to a nearby strong cue within ~0.15s;
  smaller entrances may align to a beat within ~0.10s. Three strong-cue locks, not more.
- Use the audio-reactive workflow owned by `hyperframes-creative` (let that skill locate its own
  extraction helper — do not hardcode a path). ffmpeg 9.0.2 is installed, so extraction should
  work. If it does not, document the failure here and skip it rather than blocking the render.
- Use local assets for audio and any runtime dependency.
- Run `npx hyperframes check` before render — it is brag's single gate.

---

## Build notes (as built — dark, iPhone 18 Pro)

- `npx hyperframes check` passes: **0 errors** across lint, runtime, layout, motion and contrast.
- Four lint warnings remain, all architectural preference rather than defect:
  `composition_file_too_large` and three `nested_structure_needs_subcomposition`. Splitting the
  scenes into sub-compositions was rejected on purpose — a sub-composition timeline cannot animate
  host-root elements, and one audio-reactive loop drives a glow in two different scenes.
- Twelve contrast warnings remain, every one sampled at **t=10.535s**, the midpoint of the
  closet→week crossfade where both scenes sit at ~50% opacity. Transient by construction; they
  clear at full opacity. No persistent contrast failures.
- **Two corrections found while building the dark cut**, both carried over from the light version:
  1. `content_overlap` — card three's "Regenerate" sat under the translucent tab bar and read
     through it. Card metrics were tightened by ~83px so all three days clear the bar, which also
     keeps all three outfits fully readable.
  2. The badge was semantically wrong. `ItemCard.tsx` renders the status pill only when
     `item.tagStatus !== 'tagged'`, so a grid of green "Tagged" pills is a state the app cannot be
     in. The eleven new tiles now land with the real blue **"Tagging…"** pill and it clears on the
     9.50s beat; the hero, tagged on camera in scene 1, never wears one.
- One deliberate colour deviation, marked `ACCESSIBLE` in the CSS: the app's
  `rgba(47,149,220,0.9)` "Tagging…" badge carries its white text at 3.7:1. Deepened to `#0b62c4`,
  the same white text sits at 5.9:1. The app's white tint needed no help — white on black is 21:1,
  which is part of why the dark cut is cleaner than the light one.
- Audio-reactive extraction succeeded (`extract-audio-data.py`, 30fps, 16 bands, via `uv run`).
  `assets/audio-rms.js` holds the first 633 frames of RMS and bass. On dark the glow is the light
  source, so it carries slightly more range than it did on white: opacity 0.12–0.28, scale
  1.000–1.055. Nothing else reacts.
- Strong-cue locks (three): 1.60s the hook line, 8.96s the closet grid completing, 17.91s the
  wordmark. The pills clearing at 9.50s is beat-grid, not a fourth lock.
- Rendered at `--quality delivery`: 1920x1080, 30fps, 633 frames, h264 + stereo AAC, 21.1s.
  Audio verified in the rendered file — bed at ~-26 dBFS with cue peaks at 4–6s, 9s and 12–14s,
  fading to -60 dBFS by 21s.
- The poster is frame 16.6s (all three day cards settled, reason line settled, before the outro
  crossfade) and is baked as frame 0 of `brag.mp4`.
- The earlier light cut is kept as `brag-light.mp4` / `brag-light.jpg`, with its markup at
  `composition/index.light.html.bak`.
