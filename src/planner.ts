import {
  ApiError,
  planDays,
  type ApiErrorCode,
  type PlanDayResult,
  type PlanRequest,
  type PlanRequestOtherDay,
} from '@/src/api';
import type { ClosetItem, DayForecast, DayPlan, DressCodes } from '@/src/types';
import {
  buildClosetIndex,
  skipNotes,
  taggedItems,
  unsatisfiableRules,
  validatePlan,
  violationDate,
  type SkippedRule,
  type ValidationResult,
} from '@/src/validatePlan';

/**
 * The planning loop: ask `/plan`, validate the answer against the outfit
 * rules, retry exactly once with the violations attached, and turn whatever
 * comes back into `DayPlan`s.
 *
 *     plan(days) → POST /plan → validate
 *       ok            → DayPlans, status 'ok'
 *       not ok / 502  → POST /plan again with violations + warnings → validate
 *          ok         → DayPlans, status 'ok'
 *          not ok     → DayPlan { status: 'failed', reason: first violation }
 *
 * One retry, no more — the Worker never retries either, so a single tap costs
 * at most two model calls.
 *
 * Everything here is a pure function of its arguments: no store, no
 * AsyncStorage, no React. The Week screen passes the closet, forecast,
 * settings and current plans in, and persists the `DayPlan[]` it gets back.
 * That keeps the rules testable off-device and keeps this file out of the way
 * of whoever owns `src/store.tsx`.
 */

/* ------------------------------------------------------------- preflight */

/**
 * Below this many tagged items the closet cannot dress a week, and the model
 * would only produce something silly. plan.md: "If fewer than ~4 tagged items,
 * show an empty state instead of calling the AI."
 */
export const MIN_TAGGED_ITEMS = 4;

/** Why the Week screen cannot plan yet, or `null` when it can. */
export type PlanBlockReason = 'no-items' | 'not-enough-tagged' | 'no-forecast' | 'no-dates';

export interface PlanReadiness {
  ready: boolean;
  reason: PlanBlockReason | null;
  /** Tagged items found — the empty state shows "3 of 4". */
  taggedCount: number;
  message: string;
}

/**
 * The predicate the Week screen calls *before* `generatePlans`. It never calls
 * the network; a blocked closet should show an empty state, not a spinner and
 * a bill.
 */
export function planReadiness(
  closet: readonly ClosetItem[],
  forecast: readonly DayForecast[],
  dates: readonly string[]
): PlanReadiness {
  const taggedCount = taggedItems(closet).length;

  if (closet.length === 0) {
    return {
      ready: false,
      reason: 'no-items',
      taggedCount,
      message: 'Add some clothes to your closet first.',
    };
  }
  if (taggedCount < MIN_TAGGED_ITEMS) {
    return {
      ready: false,
      reason: 'not-enough-tagged',
      taggedCount,
      message: `${taggedCount} of ${MIN_TAGGED_ITEMS} items are tagged. Add a few more before planning.`,
    };
  }
  if (forecast.length === 0) {
    return {
      ready: false,
      reason: 'no-forecast',
      taggedCount,
      message: 'No forecast yet — check your location, then try again.',
    };
  }
  if (dates.length === 0) {
    return { ready: false, reason: 'no-dates', taggedCount, message: 'Nothing to plan.' };
  }

  return { ready: true, reason: null, taggedCount, message: '' };
}

/** Convenience wrapper for `if (!canPlan(...)) showEmptyState()`. */
export function canPlan(
  closet: readonly ClosetItem[],
  forecast: readonly DayForecast[],
  dates: readonly string[]
): boolean {
  return planReadiness(closet, forecast, dates).ready;
}

/* ----------------------------------------------------------------- retry */

/**
 * Failures worth a second call. A 502 (`invalid_output` / `upstream`) is the
 * case plan.md names, and a malformed 200 is the same thing wearing a hat.
 *
 * Deliberately excluded: `offline` and `timeout` (the phone has no network —
 * a second 2-minute wait helps nobody), `rate_limited` (an immediate retry is
 * the one thing guaranteed to fail), and `unauthorized` / `not_configured` /
 * `bad_request`, which are settings problems no retry can fix. Those surface
 * to the caller as a thrown `ApiError` so the Week screen can show one banner
 * and keep the plans it already has.
 */
const RETRYABLE: readonly ApiErrorCode[] = ['invalid_output', 'upstream', 'bad_response'];

function isRetryable(error: unknown): error is ApiError {
  return error instanceof ApiError && RETRYABLE.includes(error.code);
}

/* ----------------------------------------------------------------- input */

export interface GeneratePlansInput {
  /** The whole closet; only tagged items are sent. */
  closet: readonly ClosetItem[];
  /** The week's forecast (7 days). */
  forecast: readonly DayForecast[];
  /** Dates to plan: 7 for the whole week, 1 for a single-day regenerate. */
  days: readonly string[];
  /** Current plans for the days we are *not* planning. Empty for a full week. */
  otherDays: readonly PlanRequestOtherDay[];
  dressCodes: DressCodes;
  stylePreference: string;
  /** Injected for tests; defaults to `Date.now`. */
  now?: () => Date;
}

export interface GeneratePlansResult {
  /** One `DayPlan` per requested date, in the order they were requested. */
  plans: DayPlan[];
  /** True when the final attempt passed every applicable hard rule. */
  ok: boolean;
  /** 1 or 2. */
  attempts: number;
  /** Violations from the final attempt (empty when `ok`). */
  violations: string[];
  /** Soft warnings from the final attempt. Never fail a plan. */
  warnings: string[];
  /** Rules this closet cannot satisfy — worth surfacing once in the UI. */
  skipped: SkippedRule[];
}

/* ------------------------------------------------------- request assembly */


/** Only the dress codes for dates in play — no stale entries from last month. */
function relevantDressCodes(
  dressCodes: DressCodes,
  days: readonly string[],
  otherDays: readonly PlanRequestOtherDay[]
): DressCodes {
  const dates = new Set<string>(days);
  for (const other of otherDays) dates.add(other.date);

  const out: DressCodes = {};
  for (const date of dates) {
    const code = dressCodes[date];
    if (code) out[date] = code;
  }
  return out;
}

function buildRequest(
  input: GeneratePlansInput,
  notes: readonly string[],
  violations: readonly string[]
): PlanRequest {
  return {
    // Only tagged items go to the model: an untagged one has nothing to
    // reason about and would only widen the "unknown id" surface.
    items: taggedItems(input.closet),
    forecast: [...input.forecast],
    days: [...input.days],
    otherDays: [...input.otherDays],
    dressCodes: relevantDressCodes(input.dressCodes, input.days, input.otherDays),
    stylePreference: input.stylePreference.trim(),
    // Facts, not taste — the proxy renders these under their own heading so
    // the model never reads them as a style instruction.
    closetNotes: [...notes],
    violations: [...violations],
  };
}

/* ----------------------------------------------------------------- output */

const GENERIC_FAILURE = 'Could not build an outfit that follows the rules. Try again.';

/** Turns a passing response into `DayPlan`s, in the requested order. */
function toPlans(
  requestedDates: readonly string[],
  days: readonly PlanDayResult[],
  generatedAt: string
): DayPlan[] {
  const byDate = new Map<string, PlanDayResult>();
  for (const day of days) {
    if (!byDate.has(day.date)) byDate.set(day.date, day);
  }

  return requestedDates.map((date) => {
    const day = byDate.get(date);
    return {
      date,
      itemIds: day ? [...day.item_ids] : [],
      reason: day?.reason.trim() ?? '',
      generatedAt,
      status: 'ok' as const,
    };
  });
}

/**
 * Turns a failing response into `DayPlan`s. Days that broke no rule keep their
 * outfit and `status: 'ok'` — only the days actually named in a violation get
 * the error card. A violation with no date in it (there should not be one, but
 * the rules are free to add one) poisons the whole request, since we cannot
 * tell which day it meant.
 */
function toFailedPlans(
  requestedDates: readonly string[],
  days: readonly PlanDayResult[],
  violations: readonly string[],
  generatedAt: string
): DayPlan[] {
  const firstByDate = new Map<string, string>();
  let globalReason: string | null = null;

  for (const violation of violations) {
    const date = violationDate(violation);
    if (date === null) {
      globalReason ??= violation;
      continue;
    }
    if (!firstByDate.has(date)) {
      // Strip the `YYYY-MM-DD: ` prefix — the card already shows the date.
      firstByDate.set(date, violation.slice(date.length + 1).trim());
    }
  }

  const byDate = new Map<string, PlanDayResult>();
  for (const day of days) {
    if (!byDate.has(day.date)) byDate.set(day.date, day);
  }

  return requestedDates.map((date) => {
    const day = byDate.get(date);
    const reason = globalReason ?? firstByDate.get(date) ?? null;
    if (reason === null) {
      return {
        date,
        itemIds: day ? [...day.item_ids] : [],
        reason: day?.reason.trim() ?? '',
        generatedAt,
        status: 'ok' as const,
      };
    }
    return {
      // A failed card shows the error and a Regenerate button, not a collage,
      // so the half-built outfit is dropped rather than rendered as advice.
      date,
      itemIds: [],
      reason: reason.length > 0 ? reason : GENERIC_FAILURE,
      generatedAt,
      status: 'failed' as const,
    };
  });
}

/** Everything failed and we never even got an answer to judge. */
function allFailed(
  requestedDates: readonly string[],
  reason: string,
  generatedAt: string
): DayPlan[] {
  return requestedDates.map((date) => ({
    date,
    itemIds: [],
    reason,
    generatedAt,
    status: 'failed' as const,
  }));
}

/* ------------------------------------------------------------------ entry */

/**
 * Plans the given dates. Calls `/plan` once, validates, and retries at most
 * once with the violations attached.
 *
 * Throws `ApiError` when the request could not be made at all (offline, bad
 * token, rate limited) — the caller shows a banner and keeps the plans it has.
 * A plan that came back but broke the rules twice is *not* an exception: it
 * returns with `ok: false` and per-day `status: 'failed'`.
 */
export async function generatePlans(input: GeneratePlansInput): Promise<GeneratePlansResult> {
  const requestedDates = [...input.days];
  if (requestedDates.length === 0) {
    return { plans: [], ok: true, attempts: 0, violations: [], warnings: [], skipped: [] };
  }

  const now = input.now ?? (() => new Date());
  const index = buildClosetIndex(input.closet);

  // Computed up front so the *first* call already knows which rules this
  // closet cannot satisfy. Without it a four-item closet fails validation on
  // every day, burns the retry, and shows seven error cards.
  const preflightSkips = unsatisfiableRules(index, input.dressCodes, requestedDates);

  const runAttempt = async (
    notes: readonly string[],
    violations: readonly string[]
  ): Promise<{ days: PlanDayResult[]; result: ValidationResult }> => {
    const days = await planDays(buildRequest(input, notes, violations));
    const result = validatePlan({
      days,
      requestedDates,
      closet: input.closet,
      forecast: input.forecast,
      dressCodes: input.dressCodes,
      otherDays: input.otherDays,
      index,
    });
    return { days, result };
  };

  /* ---------------------------------------------------------- attempt 1 */

  let first: { days: PlanDayResult[]; result: ValidationResult } | null = null;
  let firstError: ApiError | null = null;

  try {
    first = await runAttempt(skipNotes(preflightSkips), []);
    if (first.result.ok) {
      return {
        plans: toPlans(requestedDates, first.days, now().toISOString()),
        ok: true,
        attempts: 1,
        violations: [],
        warnings: first.result.warnings,
        skipped: first.result.skipped,
      };
    }
  } catch (error) {
    if (!isRetryable(error)) throw error;
    firstError = error;
  }

  /* -------------------------------------------- attempt 2, the only retry */

  // Merge what the answer taught us about the closet into what we already
  // knew, so the retry is told about every skipped rule exactly once.
  const skips = [...new Set<SkippedRule>([...preflightSkips, ...(first?.result.skipped ?? [])])];

  // Warnings ride along as corrections but, per plan.md, never fail attempt 2.
  const corrections = first ? [...first.result.violations, ...first.result.warnings] : [];

  try {
    const second = await runAttempt(skipNotes(skips), corrections);
    const generatedAt = now().toISOString();

    if (second.result.ok) {
      return {
        plans: toPlans(requestedDates, second.days, generatedAt),
        ok: true,
        attempts: 2,
        violations: [],
        warnings: second.result.warnings,
        skipped: second.result.skipped,
      };
    }

    return {
      plans: toFailedPlans(requestedDates, second.days, second.result.violations, generatedAt),
      ok: false,
      attempts: 2,
      violations: second.result.violations,
      warnings: second.result.warnings,
      skipped: second.result.skipped,
    };
  } catch (error) {
    // The retry died on the wire. If attempt 1 at least produced something we
    // could judge, its violations are a better card than a generic banner.
    if (first) {
      return {
        plans: toFailedPlans(
          requestedDates,
          first.days,
          first.result.violations,
          now().toISOString()
        ),
        ok: false,
        attempts: 2,
        violations: first.result.violations,
        warnings: first.result.warnings,
        skipped: skips,
      };
    }
    // Both attempts failed on the wire and the second failure is the fresher
    // news; only a still-retryable pair is worth a failed card rather than a
    // thrown banner.
    if (isRetryable(error) && firstError) {
      return {
        plans: allFailed(requestedDates, error.message, now().toISOString()),
        ok: false,
        attempts: 2,
        violations: [error.message],
        warnings: [],
        skipped: skips,
      };
    }
    throw error;
  }
}
