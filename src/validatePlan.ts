import type { PlanDayResult, PlanRequestOtherDay } from '@/src/api';
import type {
  Category,
  ClosetItem,
  DayForecast,
  DressCodes,
  Formality,
  ItemTags,
} from '@/src/types';

/**
 * The outfit rules, as pure functions.
 *
 * Everything here is synchronous and side-effect free: no store, no storage,
 * no network. `src/planner.ts` feeds it the model's answer plus the closet and
 * forecast it was given, and gets back `{ ok, violations, warnings }`.
 *
 * The six hard rules (plan.md, "Outfit-rule validation") fail a plan and drive
 * the single retry. The two soft rules only ever produce warnings: they are
 * passed to the model on the retry but never fail the second attempt.
 *
 * ## Unsatisfiable rules are skipped, not failed
 *
 * The single most important behaviour in this file. A closet with no coat in
 * it can never satisfy "cold day needs outerwear"; failing the day would burn
 * the retry and leave the user staring at seven error cards they cannot fix.
 * So every rule first asks "could *this* closet possibly satisfy me?" — see
 * `ClosetCapabilities` — and skips itself when the answer is no. The skip is
 * recorded in `skipped`, and `planner.ts` turns those into a plain-English
 * note for the model ("Closet has no rainproof items; do your best.").
 *
 * A rule is only ever skipped for a *structural* shortage in the closet, never
 * because the model found the day hard. If a valid pick existed and the model
 * did not make it, that is a violation.
 */

/* ------------------------------------------------------------------ scales */

/** `casual < smart < formal`. */
const FORMALITY_RANK: Record<Formality, number> = { casual: 0, smart: 1, formal: 2 };

/** Categories a dress code applies to (shoes and accessories are advisory). */
const DRESS_CODE_CATEGORIES: readonly Category[] = ['top', 'bottom', 'dress', 'outerwear'];

/** Categories that count as "a main piece" for warmth and spread. */
const WARMTH_CATEGORIES: readonly Category[] = ['top', 'dress', 'outerwear'];
const SPREAD_CATEGORIES: readonly Category[] = ['top', 'bottom', 'dress'];

/** Below this maximum temperature a day needs outerwear. */
const COLD_TMAX_C = 12;
/** Above this chance of rain a day needs something rainproof. */
const RAIN_CHANCE_PCT = 50;
/** No single top/bottom/dress on more than this many days of the week. */
const MAX_DAYS_PER_ITEM = 3;
/** Rule 5 needs at least two torso pieces in the closet to be satisfiable. */
const MIN_TORSO_PIECES = 2;
/** Spread is only meaningful once there are more days than the cap. */
const MIN_DAYS_FOR_SPREAD = MAX_DAYS_PER_ITEM + 1;

/* ------------------------------------------------------------ closet index */

/** One tagged closet item, flattened for lookup. */
export interface IndexedItem {
  id: string;
  tags: ItemTags;
}

/**
 * What this closet is structurally capable of. Computed once from the tagged
 * items and consulted by every rule before it fires.
 */
export interface ClosetCapabilities {
  /** Does the closet contain at least one tagged item of this category? */
  has: Record<Category, boolean>;
  /** At least one item tagged `rainproof`. */
  rainproof: boolean;
  /** Tops + dresses. Fewer than two and consecutive repeats are unavoidable. */
  torsoPieces: number;
  /** How many items of each category exist (spread needs alternatives). */
  count: Record<Category, number>;
  /** The most formal item available per category, if any. */
  maxFormality: Partial<Record<Category, Formality>>;
}

export interface ClosetIndex {
  /** Tagged items only, by id. An id missing here is unusable. */
  byId: Map<string, ItemTags>;
  /** Every closet id, tagged or not — lets us say "not tagged yet" precisely. */
  allIds: Set<string>;
  capabilities: ClosetCapabilities;
}

function emptyCategoryRecord<T>(value: T): Record<Category, T> {
  return {
    top: value,
    bottom: value,
    outerwear: value,
    shoes: value,
    dress: value,
    accessory: value,
  };
}

/** Tagged items, in closet order — the only ones we ever send to the model. */
export function taggedItems(closet: readonly ClosetItem[]): IndexedItem[] {
  const out: IndexedItem[] = [];
  for (const item of closet) {
    if (item.tags) out.push({ id: item.id, tags: item.tags });
  }
  return out;
}

/** Builds the lookup + capability summary the rules run against. */
export function buildClosetIndex(closet: readonly ClosetItem[]): ClosetIndex {
  const byId = new Map<string, ItemTags>();
  const allIds = new Set<string>();
  const count = emptyCategoryRecord(0);
  const maxFormality: Partial<Record<Category, Formality>> = {};
  let rainproof = false;

  for (const item of closet) {
    allIds.add(item.id);
    if (!item.tags) continue;
    byId.set(item.id, item.tags);

    const { category, formality } = item.tags;
    count[category] += 1;
    if (item.tags.rainproof) rainproof = true;

    const best = maxFormality[category];
    if (best === undefined || FORMALITY_RANK[formality] > FORMALITY_RANK[best]) {
      maxFormality[category] = formality;
    }
  }

  const has = emptyCategoryRecord(false);
  for (const category of Object.keys(count) as Category[]) {
    has[category] = count[category] > 0;
  }

  return {
    byId,
    allIds,
    capabilities: {
      has,
      rainproof,
      torsoPieces: count.top + count.dress,
      count,
      maxFormality,
    },
  };
}

/* -------------------------------------------------------------- skip notes */

/**
 * The rules that this closet cannot satisfy. `planner.ts` turns these into
 * sentences for the model so it does not waste effort on an impossible rule.
 */
export type SkippedRule =
  | 'shoes'
  | 'composition'
  | 'outerwear'
  | 'rainproof'
  | 'repeat'
  | 'dressCode';

const SKIP_NOTES: Record<SkippedRule, string> = {
  shoes: 'Closet has no shoes; plan the rest of the outfit without them.',
  composition:
    'Closet cannot make a full outfit (it lacks a dress, or lacks a top and a bottom); use whatever main pieces exist.',
  outerwear: 'Closet has no outerwear; layer with what exists on cold days.',
  rainproof: 'Closet has no rainproof items; do your best on rainy days.',
  repeat:
    'Closet has only one top or dress, so the same one must repeat on consecutive days; that is expected.',
  dressCode:
    'Closet has no item formal enough for some dress-coded days; pick the most formal item available instead.',
};

/** Human-readable lines for every skipped rule, for the user message. */
export function skipNotes(skipped: readonly SkippedRule[]): string[] {
  return skipped.map((rule) => SKIP_NOTES[rule]);
}

/**
 * Which rules this closet cannot satisfy, worked out *before* asking the model
 * anything. `planner.ts` puts these in the first request so the model does not
 * waste its budget chasing an impossible rule; `validatePlan` recomputes the
 * same set from the answer, so the two always agree.
 *
 * The dress-code entry is necessarily approximate here — we do not yet know
 * which categories the model will pick — so it fires when any category the
 * closet *has* falls short of a requested formality.
 */
export function unsatisfiableRules(
  index: ClosetIndex,
  dressCodes: DressCodes = {},
  dates: readonly string[] = []
): SkippedRule[] {
  const caps = index.capabilities;
  const skipped: SkippedRule[] = [];

  if (!caps.has.shoes) skipped.push('shoes');
  if (!caps.has.dress && !(caps.has.top && caps.has.bottom)) skipped.push('composition');
  if (!caps.has.outerwear) skipped.push('outerwear');
  if (!caps.rainproof) skipped.push('rainproof');
  if (caps.torsoPieces < MIN_TORSO_PIECES) skipped.push('repeat');

  for (const date of dates) {
    const required = dressCodes[date];
    if (!required) continue;
    const short = DRESS_CODE_CATEGORIES.some((category) => {
      const best = caps.maxFormality[category];
      return best !== undefined && FORMALITY_RANK[best] < FORMALITY_RANK[required];
    });
    if (short) {
      skipped.push('dressCode');
      break;
    }
  }

  return skipped;
}

/* ---------------------------------------------------------------- dates */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` + n days, in UTC so no timezone can shift the calendar day. */
function shiftDate(date: string, days: number): string | null {
  if (!DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/* ----------------------------------------------------------------- input */

export interface ValidatePlanInput {
  /** The model's answer, straight from `planDays()`. */
  days: readonly PlanDayResult[];
  /** The dates we asked for. Each must come back exactly once. */
  requestedDates: readonly string[];
  /** The whole closet — untagged items included, so we can name the reason. */
  closet: readonly ClosetItem[];
  /** The week's forecast. Days with no forecast entry skip the weather rules. */
  forecast: readonly DayForecast[];
  dressCodes: DressCodes;
  /** Plans for the days we did not ask about (single-day regenerate). */
  otherDays: readonly PlanRequestOtherDay[];
  /** Pre-built index, when the caller already has one. Optional. */
  index?: ClosetIndex;
}

export interface ValidationResult {
  ok: boolean;
  /** Hard-rule failures. Date-scoped ones start `"<date>: "`. */
  violations: string[];
  /** Soft advice. Never fails a plan. */
  warnings: string[];
  /** Rules this closet cannot satisfy, so the model can be told. */
  skipped: SkippedRule[];
}

/* ------------------------------------------------------------- the rules */

/** One day's resolved items, grouped by category. */
interface ResolvedDay {
  date: string;
  items: IndexedItem[];
  byCategory: Record<Category, IndexedItem[]>;
}

function resolveDay(date: string, itemIds: readonly string[], byId: Map<string, ItemTags>): ResolvedDay {
  const items: IndexedItem[] = [];
  const byCategory: Record<Category, IndexedItem[]> = {
    top: [],
    bottom: [],
    outerwear: [],
    shoes: [],
    dress: [],
    accessory: [],
  };
  const seen = new Set<string>();
  for (const id of itemIds) {
    const tags = byId.get(id);
    // Unknown / untagged ids are reported by rule 1; they cannot take part in
    // the other rules, and a duplicate must not be counted twice.
    if (!tags || seen.has(id)) continue;
    seen.add(id);
    const item = { id, tags };
    items.push(item);
    byCategory[tags.category].push(item);
  }
  return { date, items, byCategory };
}

/** Torso pieces (tops and dresses) worn on a date — the unit rule 5 compares. */
function torsoIds(day: ResolvedDay): Set<string> {
  const ids = new Set<string>();
  for (const item of day.byCategory.top) ids.add(item.id);
  for (const item of day.byCategory.dress) ids.add(item.id);
  return ids;
}

function warmthBand(tMaxC: number): { min: number; max: number; band: string } {
  if (tMaxC >= 25) return { min: 1, max: 2, band: '25 °C or warmer' };
  if (tMaxC >= 15) return { min: 2, max: 3, band: '15–24 °C' };
  if (tMaxC >= 5) return { min: 3, max: 5, band: '5–14 °C' };
  return { min: 4, max: 5, band: 'below 5 °C' };
}

/**
 * Runs all eight rules. Pure: same inputs, same output, no I/O.
 *
 * `ok` is false only when a hard rule was both applicable and broken.
 */
export function validatePlan(input: ValidatePlanInput): ValidationResult {
  const index = input.index ?? buildClosetIndex(input.closet);
  const { byId, allIds, capabilities: caps } = index;

  const violations: string[] = [];
  const warnings: string[] = [];
  const skipped = new Set<SkippedRule>();

  const forecastByDate = new Map<string, DayForecast>();
  for (const day of input.forecast) forecastByDate.set(day.date, day);

  /* -- rule 1: real IDs, no duplicates, every requested date exactly once -- */

  const requested = new Set(input.requestedDates);
  const seenDates = new Map<string, number>();

  for (const day of input.days) {
    seenDates.set(day.date, (seenDates.get(day.date) ?? 0) + 1);

    if (!requested.has(day.date)) {
      violations.push(`${day.date}: was not one of the requested dates`);
    }

    const seenIds = new Set<string>();
    for (const id of day.item_ids) {
      if (seenIds.has(id)) {
        violations.push(`${day.date}: item ${id} is listed twice in the same day`);
        continue;
      }
      seenIds.add(id);

      if (byId.has(id)) continue;
      violations.push(
        allIds.has(id)
          ? `${day.date}: item ${id} has no tags yet and cannot be used`
          : `${day.date}: item ${id} is not in the closet`
      );
    }
  }

  for (const date of input.requestedDates) {
    const seen = seenDates.get(date) ?? 0;
    if (seen === 0) violations.push(`${date}: no outfit was returned for this date`);
    else if (seen > 1) violations.push(`${date}: returned ${seen} times; return each date once`);
  }

  /* ------------------------------ resolve the days we are actually judging */

  // Only requested dates get rule-checked. A date that should not be here at
  // all is already a rule-1 violation; running five more rules over it would
  // bury the useful message.
  const planned: ResolvedDay[] = [];
  const handled = new Set<string>();
  for (const day of input.days) {
    if (!requested.has(day.date) || handled.has(day.date)) continue;
    handled.add(day.date);
    planned.push(resolveDay(day.date, day.item_ids, byId));
  }

  // Neighbours from the existing week, for rules 5 and 8.
  const neighbours: ResolvedDay[] = [];
  for (const other of input.otherDays) {
    // A neighbour on a date we are re-planning is stale by definition.
    if (requested.has(other.date)) continue;
    neighbours.push(resolveDay(other.date, other.itemIds, byId));
  }

  /* ------------------------------------------------------- rule 2: composition */

  const canDress = caps.has.dress;
  const canSeparates = caps.has.top && caps.has.bottom;
  const compositionPossible = canDress || canSeparates;

  if (!caps.has.shoes) skipped.add('shoes');
  if (!compositionPossible) skipped.add('composition');

  for (const day of planned) {
    if (caps.has.shoes && day.byCategory.shoes.length === 0) {
      violations.push(`${day.date}: no shoes — every outfit needs shoes`);
    }
    if (!compositionPossible) continue;

    const wearsDress = day.byCategory.dress.length > 0;
    const wearsSeparates = day.byCategory.top.length > 0 && day.byCategory.bottom.length > 0;
    if (wearsDress || wearsSeparates) continue;

    violations.push(
      canDress && canSeparates
        ? `${day.date}: needs either a dress or both a top and a bottom`
        : canDress
          ? `${day.date}: needs a dress (the closet has no top-and-bottom pairing)`
          : `${day.date}: needs both a top and a bottom`
    );
  }

  /* --------------------------------------------------- rule 3: cold → outerwear */

  if (!caps.has.outerwear) skipped.add('outerwear');
  else {
    for (const day of planned) {
      const weather = forecastByDate.get(day.date);
      if (!weather || weather.tMaxC >= COLD_TMAX_C) continue;
      if (day.byCategory.outerwear.length > 0) continue;
      violations.push(
        `${day.date}: high is only ${weather.tMaxC} °C — include an outerwear item`
      );
    }
  }

  /* ---------------------------------------------------- rule 4: rain → rainproof */

  if (!caps.rainproof) skipped.add('rainproof');
  else {
    for (const day of planned) {
      const weather = forecastByDate.get(day.date);
      if (!weather || weather.rainChance <= RAIN_CHANCE_PCT) continue;
      if (day.items.some((item) => item.tags.rainproof)) continue;
      violations.push(
        `${day.date}: ${weather.rainChance}% chance of rain — include a rainproof item`
      );
    }
  }

  /* ------------------------------------------------- rule 5: no repeated top */

  if (caps.torsoPieces < MIN_TORSO_PIECES) skipped.add('repeat');
  else {
    const torsoByDate = new Map<string, Set<string>>();
    for (const day of [...planned, ...neighbours]) torsoByDate.set(day.date, torsoIds(day));

    // Walk only the days we planned, and look one day back. Looking forward as
    // well would report the same clash twice; the exception is a neighbour
    // sitting *after* a planned day, which nothing else would reach.
    for (const day of planned) {
      const mine = torsoByDate.get(day.date) ?? new Set<string>();
      if (mine.size === 0) continue;

      for (const offset of [-1, 1]) {
        const otherDate = shiftDate(day.date, offset);
        if (otherDate === null) continue;
        // Forward clashes between two planned days are caught when we reach
        // the later day, so only look forward at fixed neighbours.
        if (offset === 1 && handled.has(otherDate)) continue;

        const theirs = torsoByDate.get(otherDate);
        if (!theirs) continue;

        for (const id of mine) {
          if (!theirs.has(id)) continue;
          const tags = byId.get(id);
          const what = tags?.category === 'dress' ? 'dress' : 'top';
          violations.push(
            `${day.date}: the same ${what} (${id}) is also worn on ${otherDate} — never on two days in a row`
          );
        }
      }
    }
  }

  /* --------------------------------------------------------- rule 6: dress code */

  for (const day of planned) {
    const required = input.dressCodes[day.date];
    if (!required) continue;
    const requiredRank = FORMALITY_RANK[required];

    for (const category of DRESS_CODE_CATEGORIES) {
      for (const item of day.byCategory[category]) {
        if (FORMALITY_RANK[item.tags.formality] >= requiredRank) continue;

        // Unsatisfiable-and-skipped: if the closet holds nothing in this
        // category that clears the bar, the model had no better option.
        const best = caps.maxFormality[category];
        if (best === undefined || FORMALITY_RANK[best] < requiredRank) {
          skipped.add('dressCode');
          continue;
        }
        violations.push(
          `${day.date}: dress code is ${required} but ${category} ${item.id} is only ${item.tags.formality}`
        );
      }
    }
  }

  /* ------------------------------------------------------ warning 7: warmth band */

  for (const day of planned) {
    const weather = forecastByDate.get(day.date);
    if (!weather) continue;

    const main = day.items.filter((item) => WARMTH_CATEGORIES.includes(item.tags.category));
    if (main.length === 0) continue;

    const mean = main.reduce((sum, item) => sum + item.tags.warmth, 0) / main.length;
    const { min, max, band } = warmthBand(weather.tMaxC);
    if (mean >= min && mean <= max) continue;

    warnings.push(
      `${day.date}: mean warmth ${mean.toFixed(1)} suits ${band} poorly (aim for ${
        min === max ? min : `${min}–${max}`
      } at ${weather.tMaxC} °C)`
    );
  }

  /* ----------------------------------------------------------- warning 8: spread */

  const week = [...planned, ...neighbours];
  if (week.length >= MIN_DAYS_FOR_SPREAD) {
    const usage = new Map<string, number>();
    for (const day of week) {
      for (const category of SPREAD_CATEGORIES) {
        for (const item of day.byCategory[category]) {
          usage.set(item.id, (usage.get(item.id) ?? 0) + 1);
        }
      }
    }
    for (const [id, days] of usage) {
      if (days <= MAX_DAYS_PER_ITEM) continue;
      const tags = byId.get(id);
      // Spreading `week.length` days over `n` items of a category forces some
      // item onto `ceil(week.length / n)` days. Only complain above that
      // floor: telling someone with one pair of jeans to wear them less is
      // noise, and it would take up room in the retry prompt.
      if (tags) {
        const owned = caps.count[tags.category];
        if (owned > 0 && days <= Math.ceil(week.length / owned)) continue;
      }
      warnings.push(
        `${tags?.category ?? 'item'} ${id} is worn on ${days} of ${week.length} days — spread the closet out`
      );
    }
  }

  return { ok: violations.length === 0, violations, warnings, skipped: [...skipped] };
}

/* -------------------------------------------------------------- reporting */

/** The date a violation belongs to, when it is date-scoped. */
export function violationDate(violation: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}):/.exec(violation);
  return match ? match[1]! : null;
}
