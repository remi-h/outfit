I want to build an iPhone app called "Outfit" in this folder (/Users/remihiguchi/Documents/dev/outfit, currently empty other than this md file).

## Goal
I upload photos of my clothes. AI tags each item. Then the AI plans an outfit for each day of the coming week based on the weather forecast where I am.

## Tech stack (please use these, don't substitute)
- Expo (React Native) + TypeScript, Expo Router with tabs
- Runs on my iPhone through the Expo Go app (I don't have an Apple Developer account)
- Weather: Open-Meteo API (free, no key), using the phone's location
- AI: Claude API, model claude-sonnet-5, vision for tagging photos
- Backend: a small proxy (Cloudflare Worker or Vercel function) that holds the Claude API key. The key must NEVER be in the app code.
- Storage: on the device (expo-file-system for photos, AsyncStorage or expo-sqlite for data). No accounts or cloud database for now.

## Screens
1. Closet: grid of my clothes and an "Add" button (camera or photo library, several photos at once). Each new photo is sent to Claude, which returns JSON tags: category (top/bottom/outerwear/shoes/dress/accessory), color, warmth 1-5, formality (casual/smart/formal), rainproof (bool), season. I can view and edit the tags, and delete items.
2. Week: 7 day cards, each showing the forecast (high/low temp, rain chance, icon) and the outfit as a collage of my photos, plus a one-line reason. A "Regenerate" button for each day and one for the whole week.
3. Settings: temperature unit, a style preference in free text (e.g. "minimal, no bright colors"), and the location override.

## Outfit rules for the AI
- Only use items that are in my closet (reference them by ID; check this in code)
- Match warmth to temperature. Add outerwear when it's cold and rainproof items when rain chance is over 50%
- Don't repeat the same top on 2 days in a row, and spread items across the week
- Return strict JSON; validate it and retry once if it's invalid
- User should be able to choose if they need to address dress code for each day.

## How I'd like you to work
- Build in milestones, and stop after each one so I can test on my phone:
  1. Scaffold the project + tabs, running in Expo Go
  2. Closet: add/view/delete photos (no AI yet)
  3. Backend proxy + AI tagging
  4. Weather + Week screen with AI outfit planning
  5. Polish: loading and error states, empty states, nicer UI
- Keep it simple. No extra features, libraries or abstractions unless they're needed
- Write a README with setup steps (install, deploy the proxy, set the API key, run on the phone)
- If something is unclear, make a sensible choice, tell me what you chose, and keep going

Start with milestone 1.