# Brag Plan: Outfit

## What is this app?
An iPhone app where you photograph your clothes, Claude tags every garment, and it plans an
outfit for each of the next seven days against the real forecast where you are — using only
the clothes you actually own.

## The angle
Not a joke product, so not a joke video. The angle is **the closet becomes data, and the data
becomes a week**. Three honest moves, in order: a photo becomes a tagged garment; the garments
become seven outfits; the seven outfits are checked against real weather. The whole video is
that arc, shown in the app's own UI, with the app's own words.

The restraint is the point. Outfit is a small, complete, well-behaved app — everything on the
phone, one tiny proxy holding the key. The film should feel like the app: quiet, precise,
nothing shouting.

## Hook (first 2-3 seconds)
A single garment photo, alone, large, on a near-black stage. It settles. Nothing else moves.
One line, light weight, generous tracking: **"A photo of a jumper."**

It earns the next twenty seconds because it is so plainly under-claimed — and because the very
next beat turns that photo into structured data.

## Key moments (the middle)
- **The tag lands.** Five chips arrive one by one under the garment: `top` · `navy` · `warmth 2`
  · `smart` · `rainproof no`. This is literally `ItemTags` from `src/types.ts`. The photo is now
  a record.
- **The closet fills.** The tile pulls back into the Closet grid and eleven more garments arrive
  behind it, each carrying the real `ItemCard` status pill — which reads **"Tagging…"**, not
  "Tagged", because that component renders the pill only while `tagStatus !== 'tagged'`. The pills
  clear together once the closet is done.
- **The week resolves.** On the Week screen, "Plan week" is tapped. Three day cards fill in with
  a forecast row (glyph, high/low, rain %), an outfit collage of the user's own tiles, and one
  one-line reason in the model's voice, set large enough in the right column to actually read.

## Outro / punchline
Not a punchline — a landing. The wordmark **Outfit** at full scale, then the README's own
sentence, trimmed:

> Seven days. Real weather. Your own clothes.

Then the quiet technical line that is the actual brag: `Expo · Claude · everything on device`.
Hold. Fade.

## User flow worth showing
Entry → key action → result, exactly as the app does it:
1. **Entry:** add a photo to the Closet; it appears as a tile with a `Pending` → `Tagging…` →
   `Tagging…` badge while Claude reads it, and no badge at all once it is tagged.
2. **Key action:** on the Week screen, press **Plan week**.
3. **Result:** seven day cards, each with the forecast, a collage of your own garments, and a
   one-sentence reason.

Scenes 2 and 3 are the centerpiece and both come from this flow. There is no landing page to
fall back on and none is invented.

## Tone
- Preset: `polished`
- Creative direction: a quiet product film for a small app that is completely finished
- Interpretation: four scenes, long holds, one idea per scene, soft crossfades at 0.6s. Motion is
  slow and settled — things arrive and stay. Light-to-medium type, mixed case, generous tracking.
  No bullets, no lists, no exclamation. Confidence expressed as restraint.

## Format: landscape — 1920x1080, dark
## Duration: 21.07s (four scenes, boundaries on the music's beat grid)

## Visual identity (from the project)
Two sources of truth, and where they disagree the app wins.

**From `constants/Colors.ts` → `dark`, verbatim:**
- Screen: `#000` — `Colors.dark.background`
- Accent: `#fff` — **`tintColorDark` is white, not blue.** This is the single most important
  detail in the dark cut: `contrastOn('#fff')` returns `'#000'`, so in dark mode Outfit's
  "Plan week" button and its selected dress-code chip are white with black text. The film shows
  exactly that rather than inventing a blue accent.
- Card fill `rgba(120,120,128,0.18)` (`DayCard` darkColor), tile fill `rgba(127,127,127,0.15)`
  (`ItemCard` / `OutfitCollage`), chip border `rgba(127,127,127,0.5)`, card radius 14,
  tile radius 10 — all lifted straight from the StyleSheets

**From Apple HIG, dark:**
- Stage: `#08080a` under a radial lift to `#1a1c21` — near-black rather than pure black, so the
  encode has somewhere to go and the device reads as lit rather than cut out
- Labels: `#f5f5f7` primary, `rgba(235,235,245,0.6)` secondary, `rgba(235,235,245,0.55)` tertiary
- Separator `rgba(84,84,88,0.65)`; systemBlue `#0a84ff` for the film's own furniture and ambient
  light only — never for the app's chrome
- Type: SF Pro via the `-apple-system` stack. Apple-marketing weights and tracking on the film's
  own copy — 600 with -0.02 to -0.035em on display lines, 400 for body — while everything inside
  the phone keeps the app's real sizes and weights.
- Strongest visual element: the `OutfitCollage` — a row of rounded garment tiles that is
  unmistakably *your* wardrobe, not stock photography

### Garment imagery — a deliberate substitution
The repo contains no clothing photos (`assets/images/` holds only the stock Expo template icon
and a splash), and real photos would be the user's own wardrobe. Every garment is a flat SVG
silhouette drawn for the composition — jumper, tee, shirt, jacket, raincoat, jeans, shorts,
dress, sneaker, boot, cap — built on one common construction (neckline, shoulder, sleeve out,
sleeve in, body, hem) so a jacket reads as a jacket next to a jumper.

For dark, every colour is the same hue **lifted** into the range where it actually reads: a real
navy jumper on a near-black tile is a hole in the screen. navy `#5b72a8`, denim `#47598a`,
oat `#d6ccbc`, olive `#8ca173`, charcoal `#8a9099`, off-white `#efece6`, rust `#c9764f`,
slate `#94a7c0`, sand `#cbb795`. The restraint survives; the invisibility does not.

### The device
An **iPhone 18 Pro**: 6.3", 2622x1206 at 3x, logical **402x874 pt**. The frame is built to that
geometry and rendered at 1.07x, so the screen is 430x935 px and every size inside it is a real pt
value times 1.07 — the UI is at true device proportion rather than eyeballed. Dynamic Island at
125x36 pt, 55 pt display corner radius, 59 pt top safe area, 34 pt bottom, home indicator, and a
translucent tab bar the card list runs under.

### Nothing real leaves the repo
No API keys, no proxy URL, no `.env` values, no personal location. The city on screen is
**Lisbon** and the forecast numbers are invented but plausible. The style preference shown is
`minimal, no bright colors` — the example from the project's own `idea.md`.

## Share copy (draft)
I photographed my clothes and let Claude dress me for the week — it reads the real forecast, picks
from what I actually own, and won't put me in the same top two days running.

## Audio direction
- Role: warm, low bed with sparse professional accents. The music supports; it never drives.
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (87.6s, ~114.8 BPM) — the
  steadiest and most even-tempered of the five bundled tracks, with strong cues landing exactly
  where this storyboard wants its four scene changes.
- Music treatment: start at track 0:00 so composition time equals track time and the preset cue
  timestamps apply directly. Bed sits low (roughly -19 to -21 LUFS under the visuals), 0.5s
  fade-in from silence, 1.6s fade-out across the final hold so the outro ends quiet rather than cut.
- Music cue guidance: preset read from
  `assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json`.
  - Strong cues locked (three, as built): **1.60s** (the hook line lands), **8.96s** (the closet
    grid completes), **17.91s** (the wordmark lands). The "Tagging…" pills clearing at **9.50s**
    is beat-grid, not a fourth lock.
  - Scene boundaries on the beat grid: **4.75s**, **10.54s**, **17.39s**.
  - Beat-grid windows for sequential reveals: tag chips across 4.75→6.86 (every beat, 0.52s apart,
    acceptable because each chip is one or two words and the full set holds ~1.0s afterward);
    closet tiles across 7.70→8.96 (0.091s stagger, nothing to read); the "Tagging…" pills clearing
    together at 9.50; day cards at 12.65 / 13.70 / 14.76 (every *other* beat, 1.05s apart, because
    each card carries text).
- Audio-reactive treatment: subtle. The accent glow behind the phone frame may breathe with music
  RMS at low amplitude. No waveform bars, no pumping, no visible metering.
- SFX posture: sparse. Ten cues in twenty-one seconds, which is what the list below actually
  adds up to: five soft interface ticks (one per tag chip), one warm confirm as the twelfth tile
  lands, one click on "Plan week", and three light card-slides (one per day card). Nothing on the
  outro.
- Audio-coupled moments: the five tag chips arriving one at a time; the simulated tap on the
  "Plan week" button; the three day cards placing in sequence.
- Restraint rule: no whoosh, no riser, no impact hit, no sound under the wordmark. If a cue has to
  be loud to be heard, cut it instead. Silence under the final line is intentional.

## Storyboard

*(As built. Three things moved while composing and are corrected here rather than left
aspirational: the tag chips belong to scene 2, so they sit at 4.75–6.86 and not at the 2.12–3.70
window first sketched — that window was inside scene 1; the scene 3/4 boundary moved from 16.86 to
17.39 so the thirteen-word reason line clears its reading floor; and the three strong-cue locks are
1.60, 9.50 and 17.91.)*

Scenes 1 and 2 are **one continuous shot** — the jumper tile is the same element throughout and
shrinks into cell 0 of the closet grid, so there is no cut between them. The three clip windows
are `[0, 10.84)`, `[10.24, 17.69)` and `[17.09, 21.07)`, overlapping by 0.6s for the crossfades.

### Scene 1 — A photo of a jumper — 0 → 4.75s
Near-black stage under a soft radial lift, generous margin. A single garment tile (navy jumper, on the app's real tile
treatment) scales up from 0.94 and settles dead centre over 0.8s. It then stops completely. On the
**1.60s strong cue** a light-weight line sets beneath it with generous tracking: **"A photo of a
jumper."** It holds, fully settled, from 2.10s to 4.30s — 2.2s against a 1.5s floor for five words.
Sequential/interaction: none. One object, one line, one hold. The stillness is the scene.
Audio intent: the bed fades up from silence over 0.5s. Nothing else. The viewer should feel the
film start rather than hear it start.
Audio-coupled idea: none.
Music: warm, low, unhurried.
Transition mood: none — scene 2 is the same shot continuing.

### Scene 2 — Tagging — 4.75 → 10.54s
The hook line clears and five chips arrive one per beat at **4.75, 5.28, 5.80, 6.34, 6.86** —
the five fields of `ItemTags` for this jumper: `top` · `navy` · `warmth 2` · `smart` ·
`rainproof no`. The complete set holds for ~1.0s. At 7.38s the chips fade and the tile pulls back
into the grid; eleven more garment tiles arrive on a 0.091s stagger from 7.70s, each landing with
the blue **"Tagging…"** pill, and the last resolves exactly on the **8.96s strong cue**. On the
**9.50s** beat all eleven pills clear together, leaving a finished closet.

The hero wears no badge at any point, and the pills say "Tagging…" rather than "Tagged", because
that is what `src/components/ItemCard.tsx` actually does — it renders the pill only when
`item.tagStatus !== 'tagged'`. A closet full of green "Tagged" badges is not a state the app can
be in. Honouring that turned out to be the better beat as well as the truthful one.

Caption, centred under the grid from 8.44s: **"Claude tags every item."** — four words, held 1.6s.
Sequential/interaction: yes — five tag chips one per beat (0.52s apart; each is one or two words
and the set holds afterward), then twelve grid tiles with nothing to read.
Audio intent: precise and quiet. Each chip is a small fact being written down.
Audio-coupled idea: a soft interface tick per chip; one warm confirm as the last tile seats.
Music: steady, mid-bed, the pulse now audible under the reveals.
Transition mood: soft crossfade (0.6s, 10.24 → 10.84) → Scene 3

### Scene 3 — Plan week — 10.54 → 17.39s
An iPhone 18 Pro, portrait, left of centre, holding the real Week screen: **Lisbon** over
**"7-day forecast · updated 09:14"**, the **Plan week** pill at the right — white
with black text, because `tintColorDark` is `'#fff'` — and the Closet / Week / Settings tab bar
at the foot, translucent, with the card list running under it. The right column opens at 11.06s with an accent rule
and the line **"Seven days, from your closet."** — read and settled before anything else moves.
A cursor travels in and arrives on the pill exactly on the **12.12s** beat; the pill dips to 0.94
and a ring pulses out. Three day cards then place at **12.65, 13.70 and 14.76** — every *other*
beat, because each carries text. Card one shows the dress-code chip row (None / Casual / **Smart** /
Formal), a showers glyph, `14° / 9°` and `Showers · Rain 70%`; card two `18° / 11°` and
`Partly cloudy · Rain 20%`; card three `17° / 12°` and `Cloudy · Rain 30%`. Each carries an
`OutfitCollage` of four garment tiles. The reason line rises with card one at 12.65s, in the
right column at full legibility: **"Cool and showery — the waxed jacket keeps the rain off the navy
jumper."** — settled 13.15s to 17.39s, 4.2s against a 3.9s floor.
Sequential/interaction: yes — a simulated cursor tap on "Plan week", then three day cards one per
two beats (1.05s apart).
Audio intent: the film's one moment of forward motion. Still restrained, but the bed opens up.
Audio-coupled idea: one click on the tap; one light card-slide per day card.
Music: fullest point of the track; still mixed under the visuals.
Transition mood: soft crossfade (0.6s, 17.09 → 17.69) → Scene 4

### Scene 4 — Outfit — 17.39 → 21.07s
The phone recedes and the stage clears to near-black. The wordmark **Outfit** sets at full scale,
light weight, and resolves on the **17.91s strong cue**. Beneath it, from 18.30s:
**"Seven days. Real weather. Your own clothes."** Then, small and quiet from 19.20s:
`Expo · Claude · everything on device`. Everything holds, still, to the end.
Sequential/interaction: none.
Audio intent: the bed fades out from 19.50s across the final hold. The film ends in near-silence
with the wordmark still on screen.
Audio-coupled idea: none — deliberately. No cue under the wordmark.
Music: fading, resolved.
Transition mood: none. The film ends on the stage it started on, held still.

**Music mood for this video:** warm, steady, understated — supportive rather than upbeat
**Audio summary:** A low warm bed fades up from silence, gathers a quiet precision as the jumper is
tagged and the closet fills, opens once for the week resolving, then fades out under a still
wordmark — ten sparse motion-matched cues in twenty-one seconds and nothing under the final line.
