import * as Location from 'expo-location';

import type { Settings } from '@/src/types';

/**
 * Where to fetch the forecast for: the Settings override if the user set one,
 * otherwise the phone's GPS.
 *
 * Nothing in here throws. Location is the one input the user can permanently
 * refuse, so `resolveLocation` always resolves to a value the caller can
 * render — a place, or a reason plus whether asking again would do anything.
 * The permission prompt fires here, at the point of use (first time the Week
 * screen needs a forecast), never at startup.
 */

/** A coordinate with a name to put in the Week header. Matches `Settings.locationOverride`. */
export interface Place {
  name: string;
  latitude: number;
  longitude: number;
}

export type LocationResult =
  | { status: 'ok'; place: Place; source: 'override' | 'gps' }
  /**
   * The user said no. `canAskAgain` is false once iOS stops showing the
   * prompt — from then on the only routes forward are the Settings app or a
   * location override, which is what the message says.
   */
  | { status: 'denied'; canAskAgain: boolean; message: string }
  /** Granted (or not needed), but no fix: location services off, indoors, timeout. */
  | { status: 'unavailable'; message: string };

const DENIED_RETRY_MESSAGE =
  'Outfit needs your location to fetch the forecast. Allow it, or set a city in Settings.';

const DENIED_PERMANENT_MESSAGE =
  'Location access is off for Outfit. Turn it on in iOS Settings, or set a city in Settings.';

const NO_FIX_MESSAGE =
  "Couldn't get your location. Check that Location Services are on, or set a city in Settings.";

/* ------------------------------------------------------------ permissions */

/**
 * Mirrors `ensureCameraPermission` / `ensureLibraryPermission` in
 * `src/photos.ts`: read the current status first so an already-granted app
 * never re-prompts, only ask when iOS would actually show the dialog, and
 * report `canAskAgain` so the caller can tell "tap again" from "go to
 * Settings".
 */
async function ensureForegroundPermission(): Promise<
  { granted: true } | { granted: false; canAskAgain: boolean }
> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return { granted: true };
    if (!current.canAskAgain) return { granted: false, canAskAgain: false };

    const asked = await Location.requestForegroundPermissionsAsync();
    if (asked.granted) return { granted: true };
    return { granted: false, canAskAgain: asked.canAskAgain };
  } catch (error) {
    // The permission call itself failing is not something the user can act on
    // differently from a denial that can be retried.
    console.warn('[location] permission check failed', error);
    return { granted: false, canAskAgain: true };
  }
}

/* --------------------------------------------------------------- resolving */

/**
 * Best-effort city name for a GPS fix. Open-Meteo's forecast response has no
 * place name, and "Somewhere" in the Week header is worse than a city. A
 * failure here is not a failure of the lookup: the caller falls back to the
 * timezone-derived name in `src/weather.ts`.
 */
async function describeCoordinate(latitude: number, longitude: number): Promise<string> {
  try {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!address) return '';
    return address.city ?? address.subregion ?? address.region ?? address.country ?? '';
  } catch (error) {
    console.warn('[location] reverse geocode failed', error);
    return '';
  }
}

/**
 * Narrows a stored location override to a usable `Place`, or `null`.
 *
 * The store hydrates settings by spreading whatever JSON is in AsyncStorage
 * over the defaults, so a half-written or hand-edited blob can put anything
 * under `locationOverride`. Everything that reads it — this module and the
 * Settings screen — goes through here, so a bad blob degrades to "use GPS"
 * instead of throwing on `undefined.toFixed`.
 */
export function normalizePlace(value: unknown): Place | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Place>;
  if (typeof candidate.latitude !== 'number' || !Number.isFinite(candidate.latitude)) return null;
  if (typeof candidate.longitude !== 'number' || !Number.isFinite(candidate.longitude)) return null;

  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  return {
    name: name || 'Custom location',
    latitude: candidate.latitude,
    longitude: candidate.longitude,
  };
}

/**
 * The override wins when it is set — that is the whole point of it, and it
 * means a user who denied location permission still gets a forecast without
 * ever seeing the prompt again.
 */
export async function resolveLocation(settings: Settings): Promise<LocationResult> {
  const override = normalizePlace(settings.locationOverride);
  if (override) {
    return { status: 'ok', source: 'override', place: override };
  }

  const permission = await ensureForegroundPermission();
  if (!permission.granted) {
    return {
      status: 'denied',
      canAskAgain: permission.canAskAgain,
      message: permission.canAskAgain ? DENIED_RETRY_MESSAGE : DENIED_PERMANENT_MESSAGE,
    };
  }

  let position: Location.LocationObject;
  try {
    position = await Location.getCurrentPositionAsync({
      // `Balanced` is ~100 m and resolves much faster indoors than `High`.
      // A city-scale forecast does not care about the difference.
      accuracy: Location.Accuracy.Balanced,
    });
  } catch (error) {
    console.warn('[location] could not get a fix', error);
    return { status: 'unavailable', message: NO_FIX_MESSAGE };
  }

  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { status: 'unavailable', message: NO_FIX_MESSAGE };
  }

  return {
    status: 'ok',
    source: 'gps',
    place: { name: await describeCoordinate(latitude, longitude), latitude, longitude },
  };
}

/* --------------------------------------------------------------- geocoding */

const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

/** A city lookup is a foreground, user-initiated action; keep the wait short. */
const GEOCODE_TIMEOUT_MS = 10_000;

export type GeocodeResult =
  | { status: 'ok'; place: Place }
  /** The API answered, but knows no such place. */
  | { status: 'not_found' }
  /** We never got an answer: offline, timeout, non-200, unreadable body. */
  | { status: 'error'; message: string };

const GEOCODE_ERROR_MESSAGE = "Couldn't look that up. Check your connection and try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds a display name from a geocoding hit: "Tokyo, Japan", or
 * "Springfield, Illinois, United States" when the admin area disambiguates.
 */
function placeName(hit: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof hit.name === 'string' && hit.name.trim()) parts.push(hit.name.trim());
  if (typeof hit.admin1 === 'string' && hit.admin1.trim() && hit.admin1 !== hit.name) {
    parts.push(hit.admin1.trim());
  }
  if (typeof hit.country === 'string' && hit.country.trim()) parts.push(hit.country.trim());
  return parts.join(', ');
}

/**
 * Looks up a free-text place name. Never throws — the three outcomes the
 * Settings screen has to tell apart ("here it is", "no such place", "the
 * lookup failed") are the three variants of `GeocodeResult`.
 *
 * Note that Open-Meteo answers an unknown name with `200` and a body that has
 * no `results` key at all, so "not found" is the absence of the array, not an
 * error status.
 */
export async function geocodeResult(query: string): Promise<GeocodeResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { status: 'not_found' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${GEOCODING_ENDPOINT}?name=${encodeURIComponent(trimmed)}&count=1`,
      { signal: controller.signal }
    );
  } catch (error) {
    const aborted =
      controller.signal.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.message.includes('Aborted')));
    return {
      status: 'error',
      message: aborted ? 'The lookup took too long. Try again.' : GEOCODE_ERROR_MESSAGE,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) return { status: 'error', message: GEOCODE_ERROR_MESSAGE };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    return { status: 'error', message: GEOCODE_ERROR_MESSAGE };
  }

  const results = isRecord(parsed) ? parsed.results : undefined;
  if (!Array.isArray(results) || results.length === 0) return { status: 'not_found' };

  const hit = results[0];
  if (!isRecord(hit)) return { status: 'not_found' };

  const { latitude, longitude } = hit;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return { status: 'not_found' };
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return { status: 'not_found' };

  const name = placeName(hit);
  if (!name) return { status: 'not_found' };

  return { status: 'ok', place: { name, latitude, longitude } };
}

/**
 * The plan.md signature: a place, or `null` for both "no such place" and "the
 * lookup failed". Settings uses `geocodeResult` so it can word those two
 * differently.
 */
export async function geocode(query: string): Promise<Place | null> {
  const result = await geocodeResult(query);
  return result.status === 'ok' ? result.place : null;
}
