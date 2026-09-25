import type { SymbolViewProps } from 'expo-symbols';

import type { DayForecast, Forecast, Settings } from '@/src/types';

/**
 * Open-Meteo forecast (no API key) plus the two pure helpers the Week screen
 * needs to draw it: a WMO code → icon/label map and a display-temperature
 * converter.
 *
 * **Everything stored is Celsius.** The API is asked for metric and the
 * `Forecast` written to AsyncStorage is metric; `Settings.unit` is consulted
 * only by `toDisplayTemp`, at render time. The outfit rules in
 * `src/validatePlan.ts` compare against `tMaxC`/`tMinC` directly, so flipping
 * the unit toggle can never change what the AI is asked for or what passes
 * validation.
 */

/* ------------------------------------------------------------------ config */

const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const DAILY_FIELDS =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max';

/** Today + the next six days. */
export const FORECAST_DAYS = 7;

/** How long a stored forecast is considered fresh (plan.md: cached 3 h). */
export const FORECAST_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** Open-Meteo is fast; a hung socket should not block the Week screen. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Four decimals is ~11 m — far more precision than a city-scale forecast uses,
 * and it keeps the exact GPS fix out of the query string.
 */
function roundCoord(value: number): string {
  return value.toFixed(4);
}

/** The exact request from plan.md. Exported so the Week screen can log it. */
export function forecastUrl(latitude: number, longitude: number): string {
  return (
    `${FORECAST_ENDPOINT}?latitude=${roundCoord(latitude)}&longitude=${roundCoord(longitude)}` +
    `&daily=${DAILY_FIELDS}&timezone=auto&forecast_days=${FORECAST_DAYS}`
  );
}

/* ------------------------------------------------------------------ errors */

export type WeatherErrorCode =
  /** The phone could not reach Open-Meteo at all (airplane mode, DNS). */
  | 'offline'
  /** We gave up waiting. */
  | 'timeout'
  /** A non-200 answer — bad coordinates, or Open-Meteo having a bad day. */
  | 'http'
  /** 200, but the body was not the shape we asked for. */
  | 'bad_response'
  /** Anything unclassified. */
  | 'unknown';

export class WeatherError extends Error {
  readonly code: WeatherErrorCode;
  /** HTTP status, when there was one. */
  readonly status?: number;

  constructor(code: WeatherErrorCode, message?: string, status?: number) {
    super(message ?? weatherErrorMessage(code));
    this.name = 'WeatherError';
    this.code = code;
    this.status = status;
    // Keeps `instanceof` working when the class is down-levelled.
    Object.setPrototypeOf(this, WeatherError.prototype);
  }
}

/** One short, user-facing sentence per failure mode. */
export function weatherErrorMessage(code: WeatherErrorCode): string {
  switch (code) {
    case 'offline':
      return "Couldn't reach the weather service. Check your connection.";
    case 'timeout':
      return 'The weather service took too long to answer. Try again.';
    case 'http':
      return 'The weather service returned an error. Try again shortly.';
    case 'bad_response':
      return "The weather service sent something we couldn't read. Try again.";
    default:
      return "Couldn't load the forecast. Try again.";
  }
}

/** Turns anything thrown while fetching weather into a `WeatherError`. */
export function toWeatherError(error: unknown): WeatherError {
  if (error instanceof WeatherError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new WeatherError('unknown', `${weatherErrorMessage('unknown')} (${detail})`);
}

/* ----------------------------------------------------------------- parsing */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberAt(list: unknown, index: number): number | null {
  if (!Array.isArray(list)) return null;
  const value = list[index];
  // Open-Meteo sends `null` for a field it has no data for.
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `YYYY-MM-DD`, which is what Open-Meteo returns under `daily.time`. */
function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Derives something human from `timezone` ("Europe/London" → "London") for the
 * case where the caller has no place name — a GPS fix whose reverse geocode
 * failed. Better than a blank header, and never wrong enough to matter.
 */
function nameFromTimezone(timezone: unknown): string {
  if (typeof timezone !== 'string') return '';
  const tail = timezone.split('/').pop();
  return tail ? tail.replace(/_/g, ' ') : '';
}

/**
 * Validates the response body before any of it reaches the store. A field that
 * is missing, null or the wrong type drops that one day rather than throwing,
 * so a partial answer still renders; a body with no usable day at all is a
 * `bad_response`.
 */
function parseForecast(
  body: unknown,
  latitude: number,
  longitude: number,
  locationName: string
): Forecast {
  if (!isRecord(body) || !isRecord(body.daily)) throw new WeatherError('bad_response');

  const daily = body.daily;
  const times = daily.time;
  if (!Array.isArray(times) || times.length === 0) throw new WeatherError('bad_response');

  const days: DayForecast[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < times.length && days.length < FORECAST_DAYS; index += 1) {
    const date = times[index];
    if (!isDateKey(date) || seen.has(date)) continue;

    const tMaxC = numberAt(daily.temperature_2m_max, index);
    const tMinC = numberAt(daily.temperature_2m_min, index);
    if (tMaxC === null || tMinC === null) continue;

    // A missing rain probability is treated as 0 rather than dropping the day:
    // the temperatures are the part the outfit rules lean on hardest, and
    // "unknown chance of rain" behaves like "no rain warning".
    const rain = numberAt(daily.precipitation_probability_max, index) ?? 0;
    const code = numberAt(daily.weather_code, index);

    seen.add(date);
    days.push({
      date,
      tMaxC,
      tMinC,
      rainChance: Math.min(100, Math.max(0, Math.round(rain))),
      weatherCode: code === null ? -1 : Math.round(code),
    });
  }

  if (days.length === 0) throw new WeatherError('bad_response');

  return {
    fetchedAt: new Date().toISOString(),
    latitude,
    longitude,
    locationName: locationName.trim() || nameFromTimezone(body.timezone),
    days,
  };
}

/* ----------------------------------------------------------------- fetching */

/**
 * Fetches seven days of **Celsius** forecast for a coordinate.
 *
 * `locationName` is what the Week screen puts in its header; it comes from the
 * settings override or a reverse geocode (`src/location.ts`). Omit it and the
 * response's own timezone is used as a fallback.
 *
 * Throws `WeatherError` for every failure path — network, timeout, non-200 and
 * malformed body are separate codes.
 */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  locationName = ''
): Promise<Forecast> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new WeatherError('bad_response', 'That location has no usable coordinates.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(forecastUrl(latitude, longitude), { signal: controller.signal });
  } catch (error) {
    // Our own abort is a timeout; anything else is the phone failing to reach
    // the host at all.
    const aborted =
      controller.signal.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.message.includes('Aborted')));
    throw new WeatherError(aborted ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => '');
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    // Open-Meteo's error bodies look like `{ error: true, reason: "…" }`.
    const reason = isRecord(parsed) && typeof parsed.reason === 'string' ? parsed.reason : undefined;
    throw new WeatherError(
      'http',
      reason ? `${weatherErrorMessage('http')} (${reason})` : undefined,
      response.status
    );
  }

  if (parsed === undefined) throw new WeatherError('bad_response');
  return parseForecast(parsed, latitude, longitude, locationName);
}

/* -------------------------------------------------------------- staleness */

/** True when there is no forecast, or the one we have is older than `maxAgeMs`. */
export function isForecastStale(
  forecast: Forecast | null,
  maxAgeMs: number = FORECAST_MAX_AGE_MS
): boolean {
  if (!forecast) return true;
  const fetchedAt = Date.parse(forecast.fetchedAt);
  // An unparseable timestamp counts as stale — refetching is always safe.
  if (!Number.isFinite(fetchedAt)) return true;
  return Date.now() - fetchedAt > maxAgeMs;
}

/**
 * True when the stored forecast is for a different place than the one we just
 * resolved. ~0.05° is roughly 5 km: enough to ignore GPS jitter, small enough
 * to catch "I set an override to Tokyo".
 */
export function isForecastForElsewhere(
  forecast: Forecast | null,
  latitude: number,
  longitude: number
): boolean {
  if (!forecast) return true;
  return (
    Math.abs(forecast.latitude - latitude) > 0.05 || Math.abs(forecast.longitude - longitude) > 0.05
  );
}

/* ------------------------------------------------------------------- dates */

/** `YYYY-MM-DD` for a `Date`, in the phone's local timezone (plan.md). */
export function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Today plus the next six days, local time — the week the app plans for.
 *
 * With no location override this lines up with what Open-Meteo returns under
 * `timezone=auto`. With an override in a different timezone it may not: asking
 * for Tokyo from London can return a first day one ahead of the phone's today.
 * So treat `forecast.days[].date` as the source of truth for what to render
 * and plan, and use this only where you genuinely mean "the phone's week"
 * (e.g. deciding a stored plan is in the past).
 */
export function weekDates(from: Date = new Date()): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < FORECAST_DAYS; offset += 1) {
    // Constructing from the Y/M/D parts (rather than adding milliseconds)
    // keeps this correct across a DST change.
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    dates.push(toDateKey(day));
  }
  return dates;
}

/* ------------------------------------------------------------ temperatures */

/**
 * Rounds a stored Celsius value for display in the user's chosen unit. This is
 * the *only* place `Settings.unit` is allowed to matter — nothing converted
 * here is ever written back to the store.
 */
export function toDisplayTemp(celsius: number, unit: Settings['unit']): number {
  if (!Number.isFinite(celsius)) return 0;
  return Math.round(unit === 'F' ? celsius * (9 / 5) + 32 : celsius);
}

/** `'°C'` / `'°F'`, for labels next to a `toDisplayTemp` value. */
export function unitSuffix(unit: Settings['unit']): string {
  return unit === 'F' ? '°F' : '°C';
}

/* ------------------------------------------------------------- WMO → icon */

/**
 * expo-symbols name + label, per plan.md.
 *
 * Note for whoever builds `DayCard`: the scaffold kept `expo-symbols` and
 * dropped `@expo/vector-icons`, so `Ionicons` is not currently an installed
 * dependency. Use `symbol` with `<SymbolView />` (as `EmptyState.tsx` does) and
 * nothing needs installing; `icon` is here for parity with the plan if the
 * icon set is ever added back.
 */
export interface WeatherIcon {
  /** An `expo-symbols` name, rendered with <SymbolView/>. */
  symbol: SymbolViewProps['name'];
  /** Two or three words, e.g. "Heavy rain". */
  label: string;
}

const CLEAR: WeatherIcon = {
  symbol: { ios: 'sun.max.fill', android: 'sunny', web: 'sunny' },
  label: 'Clear',
};
const MAINLY_CLEAR: WeatherIcon = {
  symbol: { ios: 'cloud.sun.fill', android: 'partly_cloudy_day', web: 'partly_cloudy_day' },
  label: 'Partly cloudy',
};
const OVERCAST: WeatherIcon = {
  symbol: { ios: 'cloud.fill', android: 'cloud', web: 'cloud' },
  label: 'Overcast',
};
const FOG: WeatherIcon = {
  symbol: { ios: 'cloud.fog.fill', android: 'foggy', web: 'foggy' },
  label: 'Fog',
};
const DRIZZLE: WeatherIcon = {
  symbol: { ios: 'cloud.drizzle.fill', android: 'rainy', web: 'rainy' },
  label: 'Drizzle',
};
const FREEZING_DRIZZLE: WeatherIcon = {
  symbol: { ios: 'cloud.sleet.fill', android: 'rainy', web: 'rainy' },
  label: 'Freezing drizzle',
};
const RAIN: WeatherIcon = {
  symbol: { ios: 'cloud.rain.fill', android: 'rainy', web: 'rainy' },
  label: 'Rain',
};
const HEAVY_RAIN: WeatherIcon = {
  symbol: { ios: 'cloud.heavyrain.fill', android: 'rainy', web: 'rainy' },
  label: 'Heavy rain',
};
const FREEZING_RAIN: WeatherIcon = {
  symbol: { ios: 'cloud.sleet.fill', android: 'rainy', web: 'rainy' },
  label: 'Freezing rain',
};
const SNOW: WeatherIcon = {
  symbol: { ios: 'cloud.snow.fill', android: 'weather_snowy', web: 'weather_snowy' },
  label: 'Snow',
};
const SHOWERS: WeatherIcon = {
  symbol: { ios: 'cloud.rain.fill', android: 'rainy', web: 'rainy' },
  label: 'Showers',
};
const SNOW_SHOWERS: WeatherIcon = {
  symbol: { ios: 'cloud.snow.fill', android: 'weather_snowy', web: 'weather_snowy' },
  label: 'Snow showers',
};
const THUNDERSTORM: WeatherIcon = {
  symbol: { ios: 'cloud.bolt.rain.fill', android: 'thunderstorm', web: 'thunderstorm' },
  label: 'Thunderstorm',
};
const UNKNOWN: WeatherIcon = {
  symbol: { ios: 'cloud.fill', android: 'cloud', web: 'cloud' },
  label: 'Unknown',
};

/**
 * WMO 4677 weather code → icon + label. Written as ranges rather than a lookup
 * of the handful of codes we happened to see, because Open-Meteo will happily
 * return any of them; anything outside the table (including our own `-1` for a
 * missing code) falls back to a neutral cloud rather than rendering nothing.
 */
export function wmoToIcon(code: number): WeatherIcon {
  if (!Number.isFinite(code)) return UNKNOWN;
  const wmo = Math.round(code);

  if (wmo === 0) return CLEAR;
  if (wmo === 1 || wmo === 2) return MAINLY_CLEAR;
  if (wmo === 3) return OVERCAST;
  if (wmo >= 40 && wmo <= 49) return FOG; // 45 fog, 48 depositing rime fog
  if (wmo >= 51 && wmo <= 55) return DRIZZLE;
  if (wmo === 56 || wmo === 57) return FREEZING_DRIZZLE;
  if (wmo === 61 || wmo === 63) return RAIN;
  if (wmo === 65) return HEAVY_RAIN;
  if (wmo === 66 || wmo === 67) return FREEZING_RAIN;
  if (wmo >= 71 && wmo <= 77) return SNOW; // 71/73/75 snowfall, 77 snow grains
  if (wmo >= 80 && wmo <= 82) return SHOWERS;
  if (wmo === 85 || wmo === 86) return SNOW_SHOWERS;
  if (wmo >= 95 && wmo <= 99) return THUNDERSTORM;
  return UNKNOWN;
}
