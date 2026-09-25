import type {
  Category,
  DayForecast,
  DressCodes,
  Formality,
  ItemTags,
  Season,
} from '@/src/types';

/**
 * Thin fetch wrapper around the key-holding proxy (`proxy/` — a Cloudflare
 * Worker). The Anthropic key never reaches the app; the only credential we
 * send is `EXPO_PUBLIC_APP_TOKEN`, an abuse guard that ships in the JS bundle
 * and is deliberately not a secret.
 *
 * Both endpoints answer `{ error: string, message?: string }` on failure; every
 * failure in here — HTTP, network, malformed body — surfaces as an `ApiError`
 * with a `code` the UI can turn into a sentence.
 */

/* ------------------------------------------------------------------ config */

// `process.env.EXPO_PUBLIC_*` is substituted at bundle time by Expo's Babel
// plugin, so these must be written as literal member expressions — no dynamic
// key lookup, no destructuring of `process.env`.
const PROXY_URL = (process.env.EXPO_PUBLIC_PROXY_URL ?? '').trim().replace(/\/+$/, '');
const APP_TOKEN = (process.env.EXPO_PUBLIC_APP_TOKEN ?? '').trim();

/** Tagging is a no-op until the user deploys the Worker and fills in `.env`. */
export function isProxyConfigured(): boolean {
  return PROXY_URL.length > 0;
}

/** Shown when `EXPO_PUBLIC_PROXY_URL` is missing. */
export const PROXY_NOT_CONFIGURED_MESSAGE =
  'AI tagging is off: set EXPO_PUBLIC_PROXY_URL (and EXPO_PUBLIC_APP_TOKEN) in .env, then restart Expo.';

/** Tagging sends ~150–300 KB and waits on a vision call; be patient, but not forever. */
const TAG_TIMEOUT_MS = 60_000;
/** Planning is a bigger, slower call (7 days, adaptive thinking). */
const PLAN_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------ errors */

export type ApiErrorCode =
  /** `EXPO_PUBLIC_PROXY_URL` is empty — nothing was sent. */
  | 'not_configured'
  /** 401 — wrong or missing `EXPO_PUBLIC_APP_TOKEN`. */
  | 'unauthorized'
  /** 400 — the Worker rejected our payload. */
  | 'bad_request'
  /** 429 — Anthropic rate limit. */
  | 'rate_limited'
  /** 502 `invalid_output` — the model's output did not parse, or ours didn't. */
  | 'invalid_output'
  /** 502 `upstream` — Anthropic returned an error status. */
  | 'upstream'
  /** 503 `connection` — the Worker could not reach Anthropic. */
  | 'connection'
  /** The phone could not reach the Worker at all (airplane mode, bad URL). */
  | 'offline'
  /** We gave up waiting. */
  | 'timeout'
  /** 2xx, but the body was not the JSON we expect. */
  | 'bad_response'
  /** Anything unclassified. */
  | 'unknown';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** HTTP status, when there was one. */
  readonly status?: number;

  constructor(code: ApiErrorCode, message?: string, status?: number) {
    super(message ?? apiErrorMessage(code));
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    // Keeps `instanceof` working when the class is down-levelled.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** One short, user-facing sentence per failure mode. */
export function apiErrorMessage(code: ApiErrorCode): string {
  switch (code) {
    case 'not_configured':
      return PROXY_NOT_CONFIGURED_MESSAGE;
    case 'unauthorized':
      return 'The proxy rejected the request — check EXPO_PUBLIC_APP_TOKEN matches the Worker secret.';
    case 'bad_request':
      return 'The proxy rejected this photo. Try a different one.';
    case 'rate_limited':
      return 'The AI is busy right now. Try again in a minute.';
    case 'invalid_output':
      return "The AI's answer didn't make sense. Try again.";
    case 'upstream':
      return 'The AI service returned an error. Try again shortly.';
    case 'connection':
      return "The proxy couldn't reach the AI service. Try again shortly.";
    case 'offline':
      return "Couldn't reach the proxy. Check your connection and the proxy URL.";
    case 'timeout':
      return 'The request took too long and was cancelled. Try again.';
    case 'bad_response':
      return 'The proxy sent something unexpected. Try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/** Turns anything thrown inside the app into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ApiError('unknown', `Something went wrong. Try again. (${detail})`);
}

/* --------------------------------------------------------------- transport */

/** Error strings the Worker sends, mapped onto our codes. */
const CODE_BY_ERROR_FIELD: Record<string, ApiErrorCode> = {
  unauthorized: 'unauthorized',
  bad_request: 'bad_request',
  rate_limited: 'rate_limited',
  invalid_output: 'invalid_output',
  upstream: 'upstream',
  connection: 'connection',
};

function codeForStatus(status: number): ApiErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 400) return 'bad_request';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'connection';
  if (status >= 500) return 'upstream';
  return 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * POSTs JSON to the proxy and returns the parsed body. Throws `ApiError` for
 * every failure path, including a missing proxy URL and a timeout.
 */
async function postJson(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  if (!isProxyConfigured()) throw new ApiError('not_configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${PROXY_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${APP_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    // `AbortError` is our own timeout; anything else is the phone failing to
    // reach the Worker (airplane mode, DNS, wrong URL).
    const aborted =
      controller.signal.aborted ||
      (error instanceof Error && (error.name === 'AbortError' || error.message.includes('Aborted')));
    throw new ApiError(aborted ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => '');
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const field = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : undefined;
    const mapped: ApiErrorCode | undefined = field ? CODE_BY_ERROR_FIELD[field] : undefined;
    const code = mapped ?? codeForStatus(response.status);
    const detail = isRecord(parsed) && typeof parsed.message === 'string' ? parsed.message : undefined;
    throw new ApiError(
      code,
      detail ? `${apiErrorMessage(code)} (${detail})` : undefined,
      response.status
    );
  }

  if (parsed === undefined) throw new ApiError('bad_response');
  return parsed;
}

/* ------------------------------------------------- tag vocabulary + parsing */

/**
 * The allowed values, in the order the editor shows them. They mirror the
 * unions in `src/types.ts` and the Worker's zod schema; keeping the runtime
 * list next to the parser is what lets us reject an unexpected `category`
 * instead of writing it into the store.
 */
export const CATEGORIES: readonly Category[] = [
  'top',
  'bottom',
  'outerwear',
  'shoes',
  'dress',
  'accessory',
];
export const FORMALITIES: readonly Formality[] = ['casual', 'smart', 'formal'];
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const WARMTH_LEVELS: readonly ItemTags['warmth'][] = [1, 2, 3, 4, 5];

/**
 * Validates an untrusted `tags` object. The Worker validates too (structured
 * outputs + zod), but a bad deploy, a proxy in front of it, or a future schema
 * change must not be able to put a half-formed object into the closet — so the
 * app re-checks every field and returns `null` on anything unexpected.
 */
export function parseItemTags(value: unknown): ItemTags | null {
  if (!isRecord(value)) return null;

  const { category, color, warmth, formality, rainproof, season } = value;

  if (typeof category !== 'string' || !CATEGORIES.includes(category as Category)) return null;
  if (typeof color !== 'string') return null;
  if (typeof formality !== 'string' || !FORMALITIES.includes(formality as Formality)) return null;
  if (typeof rainproof !== 'boolean') return null;
  if (typeof warmth !== 'number' || !Number.isInteger(warmth) || warmth < 1 || warmth > 5) {
    return null;
  }
  if (!Array.isArray(season) || season.length === 0) return null;

  const seasons: Season[] = [];
  for (const entry of season) {
    if (typeof entry !== 'string' || !SEASONS.includes(entry as Season)) return null;
    if (!seasons.includes(entry as Season)) seasons.push(entry as Season);
  }

  const trimmedColour = color.trim();

  return {
    category: category as Category,
    // A blank colour is allowed by the schema but useless in the UI.
    color: trimmedColour.length > 0 ? trimmedColour.slice(0, 40) : 'unknown',
    warmth: warmth as ItemTags['warmth'],
    formality: formality as Formality,
    rainproof,
    season: seasons,
  };
}

/* -------------------------------------------------------------------- /tag */

/**
 * Sends one resized JPEG (base64, single line — see `readBase64` in
 * `src/photos.ts`) and returns validated tags.
 */
export async function tagImage(base64: string): Promise<ItemTags> {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new ApiError('bad_request', 'The photo could not be read from disk.');
  }

  const body = await postJson('/tag', { image: base64, mediaType: 'image/jpeg' }, TAG_TIMEOUT_MS);

  const tags = parseItemTags(isRecord(body) ? body.tags : undefined);
  if (!tags) throw new ApiError('invalid_output');
  return tags;
}

/* ------------------------------------------------------------------- /plan */

export interface PlanRequestItem {
  id: string;
  tags: ItemTags;
}

export interface PlanRequestOtherDay {
  date: string;
  itemIds: string[];
}

export interface PlanRequest {
  items: PlanRequestItem[];
  forecast: DayForecast[];
  /** Dates to plan: 7 for the whole week, 1 for a single-day regenerate. */
  days: string[];
  /** Existing plans for the days we are *not* planning, so neighbours differ. */
  otherDays: PlanRequestOtherDay[];
  dressCodes: DressCodes;
  stylePreference: string;
  /** App-computed facts about the closet (e.g. "no rainproof items"). */
  closetNotes: string[];
  /** Empty on the first attempt; app-generated strings on the single retry. */
  violations: string[];
}

export interface PlanDayResult {
  date: string;
  /** Snake case: this is the model's own field name, straight from the proxy. */
  item_ids: string[];
  reason: string;
}

/**
 * Milestone 4. Defined here against the `/plan` contract in `plan.md` so the
 * proxy surface lives in one file; nothing calls it yet. Rule validation and
 * the single retry belong in `src/planner.ts`, not here.
 */
export async function planDays(body: PlanRequest): Promise<PlanDayResult[]> {
  const parsed = await postJson('/plan', body, PLAN_TIMEOUT_MS);

  const rawDays = isRecord(parsed) ? parsed.days : undefined;
  if (!Array.isArray(rawDays)) throw new ApiError('invalid_output');

  const days: PlanDayResult[] = [];
  for (const raw of rawDays) {
    if (!isRecord(raw)) throw new ApiError('invalid_output');
    const { date, item_ids: itemIds, reason } = raw;
    if (typeof date !== 'string' || !Array.isArray(itemIds)) throw new ApiError('invalid_output');
    if (!itemIds.every((id): id is string => typeof id === 'string')) {
      throw new ApiError('invalid_output');
    }
    days.push({ date, item_ids: itemIds, reason: typeof reason === 'string' ? reason : '' });
  }

  return days;
}
