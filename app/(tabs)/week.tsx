import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import { toApiError, type PlanRequestOtherDay } from '@/src/api';
import DayCard from '@/src/components/DayCard';
import EmptyState from '@/src/components/EmptyState';
import ErrorBanner from '@/src/components/ErrorBanner';
import { normalizePlace, resolveLocation } from '@/src/location';
import { MIN_TAGGED_ITEMS, generatePlans, planReadiness } from '@/src/planner';
import { useAppState } from '@/src/store';
import type { Category, DayForecast, Formality } from '@/src/types';
import { buildClosetIndex } from '@/src/validatePlan';
import {
  fetchForecast,
  isForecastForElsewhere,
  isForecastStale,
  toDateKey,
  toWeatherError,
} from '@/src/weather';

/**
 * The Week screen: seven day cards, a forecast, and the two ways to ask the AI
 * for outfits.
 *
 * ## Which seven days?
 *
 * `forecast.days[].date` — never `weekDates()`. Open-Meteo is called with
 * `timezone=auto`, so a location override in another timezone answers with a
 * first day that is *not* the phone's today; keying the cards off the phone's
 * calendar would render seven dates the forecast has nothing for, and ask the
 * model to plan them. The phone's calendar is used for one thing only: the
 * "Today"/"Tomorrow" caption, which is about the user, not the weather.
 *
 * ## One request at a time
 *
 * `planBusyRef` is set and checked in the same synchronous block, so a double
 * tap (or a tap on "Plan week" while a single day is regenerating) cannot
 * start a second `/plan` call. Every button is also visibly disabled while
 * `planningDates` is non-null.
 *
 * ## What a failure keeps
 *
 * Nothing here ever clears `plans` or `forecast` on error. A denied location,
 * a dead network or an AI failure adds a banner *above* what is already on
 * screen; the last good week keeps rendering underneath it (plan.md).
 */

/* ------------------------------------------------ dress-code bookkeeping
 *
 * `dressCodes` carries no timestamp, so "the user changed the chip after this
 * outfit was planned" cannot be read out of the store. It is derived instead,
 * by making the same comparison `validatePlan` rule 6 makes: if any main piece
 * in the stored outfit is less formal than the chip, the outfit no longer
 * matches the request. That is true whether the chip moved or the outfit did.
 *
 * `FORMALITY_RANK` and the category list are duplicated from
 * `src/validatePlan.ts` because that module does not export them, and rule 6
 * cannot be reused directly: `validatePlan` judges a *fresh model answer*
 * against every rule at once, and would report shoes and composition problems
 * we are not asking about here.
 */

const FORMALITY_RANK: Record<Formality, number> = { casual: 0, smart: 1, formal: 2 };

/** Categories a dress code applies to — shoes and accessories are advisory. */
const DRESS_CODE_CATEGORIES: readonly Category[] = ['top', 'bottom', 'dress', 'outerwear'];

/* ----------------------------------------------------------------- screen */

interface DayRow {
  date: string;
  weather: DayForecast | null;
}

export default function WeekScreen() {
  const router = useRouter();
  const {
    closet,
    plans,
    settings,
    forecast,
    dressCodes,
    setPlans,
    setDayPlan,
    setForecast,
    setDressCode,
  } = useAppState();

  const tint = useThemeColor({}, 'tint');

  const [refreshing, setRefreshing] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  /** The dates of the request in flight, or null when nothing is running. */
  const [planningDates, setPlanningDates] = useState<readonly string[] | null>(null);

  /* ------------------------------------------------------------ forecast */

  const forecastBusyRef = useRef(false);

  const refreshForecast = useCallback(
    async (force: boolean) => {
      // Synchronous guard: focus, pull-to-refresh and a banner Retry can all
      // arrive in the same frame.
      if (forecastBusyRef.current) return;

      // Cheap pre-check, so switching to this tab with a fresh forecast does
      // not wake the GPS (or re-prompt) on every visit. An override gives us
      // coordinates without asking anyone; without one we can only tell
      // staleness here, and the same "is it for elsewhere" test runs again
      // below once the fix lands.
      const override = normalizePlace(settings.locationOverride);
      const stale = isForecastStale(forecast);
      const elsewhere =
        override !== null &&
        isForecastForElsewhere(forecast, override.latitude, override.longitude);
      if (!force && !stale && !elsewhere) return;

      forecastBusyRef.current = true;
      setRefreshing(true);
      try {
        // Never throws: denied / unavailable are values, not exceptions.
        const location = await resolveLocation(settings);
        if (location.status !== 'ok') {
          setLocationError(location.message);
          // Deliberately no `setForecast(null)`: a stale forecast and the
          // plans built from it are better than a blank screen.
          return;
        }
        setLocationError(null);

        const { place } = location;
        if (
          !force &&
          !isForecastStale(forecast) &&
          !isForecastForElsewhere(forecast, place.latitude, place.longitude)
        ) {
          return;
        }

        setForecast(await fetchForecast(place.latitude, place.longitude, place.name));
        setForecastError(null);
      } catch (error) {
        setForecastError(toWeatherError(error).message);
      } finally {
        forecastBusyRef.current = false;
        setRefreshing(false);
      }
    },
    [forecast, settings, setForecast]
  );

  // On focus: refetch when the forecast is missing, older than 3 h, or for a
  // different place. `refreshForecast` decides; this just pokes it.
  useFocusEffect(
    useCallback(() => {
      void refreshForecast(false);
    }, [refreshForecast])
  );

  /* --------------------------------------------------------- derived data */

  const itemsById = useMemo(() => new Map(closet.map((item) => [item.id, item])), [closet]);
  const plansByDate = useMemo(() => new Map(plans.map((plan) => [plan.date, plan])), [plans]);
  const capabilities = useMemo(() => buildClosetIndex(closet).capabilities, [closet]);

  const forecastDays = useMemo(() => forecast?.days ?? [], [forecast]);

  /** The week, as the forecast defines it. Empty when we have no forecast. */
  const planDates = useMemo(() => forecastDays.map((day) => day.date), [forecastDays]);

  /**
   * Cards to draw. With no forecast at all we still list whatever plans are
   * stored, so an offline cold open shows last week's outfits rather than
   * nothing.
   */
  const rows: DayRow[] = useMemo(() => {
    if (forecastDays.length > 0) {
      return forecastDays.map((day) => ({ date: day.date, weather: day }));
    }
    return plans.map((plan) => ({ date: plan.date, weather: null }));
  }, [forecastDays, plans]);

  const readiness = useMemo(
    () => planReadiness(closet, forecastDays, planDates),
    [closet, forecastDays, planDates]
  );

  const needsRegenerateFor = useCallback(
    (date: string): boolean => {
      const required = dressCodes[date];
      if (!required) return false;

      const plan = plansByDate.get(date);
      if (!plan || plan.status !== 'ok' || plan.itemIds.length === 0) return false;

      const requiredRank = FORMALITY_RANK[required];
      for (const id of plan.itemIds) {
        const tags = itemsById.get(id)?.tags;
        if (!tags || !DRESS_CODE_CATEGORIES.includes(tags.category)) continue;
        if (FORMALITY_RANK[tags.formality] >= requiredRank) continue;

        // Same escape hatch as rule 6: if the closet owns nothing in this
        // category that clears the bar, regenerating cannot help and the label
        // would be a lie.
        const best = capabilities.maxFormality[tags.category];
        if (best === undefined || FORMALITY_RANK[best] < requiredRank) continue;
        return true;
      }
      return false;
    },
    [capabilities, dressCodes, itemsById, plansByDate]
  );

  /* -------------------------------------------------------------- planning */

  const planBusyRef = useRef(false);
  const lastRequestRef = useRef<readonly string[] | null>(null);

  const runPlan = useCallback(
    async (dates: readonly string[]) => {
      if (planBusyRef.current) return;

      // The gate: no closet, too few tagged items, or no forecast means an
      // empty state, never a request.
      const check = planReadiness(closet, forecastDays, dates);
      if (!check.ready) {
        setPlanError(check.message);
        return;
      }

      planBusyRef.current = true;
      lastRequestRef.current = dates;
      setPlanningDates(dates);
      setPlanError(null);

      try {
        // Whole week: nothing else to respect. Single day: the other six
        // current outfits go along as neighbours, so the model can avoid
        // repeating yesterday's top and keep spreading the closet.
        const otherDays: PlanRequestOtherDay[] =
          dates.length === 1
            ? plans
                .filter(
                  (plan) =>
                    plan.date !== dates[0] &&
                    planDates.includes(plan.date) &&
                    plan.itemIds.length > 0
                )
                .map((plan) => ({ date: plan.date, itemIds: [...plan.itemIds] }))
            : [];

        const result = await generatePlans({
          closet,
          forecast: forecastDays,
          days: dates,
          otherDays,
          dressCodes,
          stylePreference: settings.stylePreference,
        });

        if (dates.length === 1) {
          // `setDayPlan` replaces one date and leaves the other six untouched.
          const only = result.plans.find((plan) => plan.date === dates[0]);
          if (only) setDayPlan(only);
        } else if (result.plans.length > 0) {
          setPlans(result.plans);
        }
      } catch (error) {
        // Offline, bad token, rate limited: one banner, and every stored plan
        // stays exactly where it was.
        setPlanError(toApiError(error).message);
      } finally {
        planBusyRef.current = false;
        setPlanningDates(null);
      }
    },
    [
      closet,
      dressCodes,
      forecastDays,
      planDates,
      plans,
      setDayPlan,
      setPlans,
      settings.stylePreference,
    ]
  );

  const planWeek = useCallback(() => {
    void runPlan(planDates);
  }, [planDates, runPlan]);

  const regenerateDay = useCallback(
    (date: string) => {
      void runPlan([date]);
    },
    [runPlan]
  );

  const retryPlan = useCallback(() => {
    const last = lastRequestRef.current;
    if (last && last.length > 0) void runPlan(last);
  }, [runPlan]);

  /* --------------------------------------------------------------- render */

  const openSettings = useCallback(() => {
    router.push('/settings');
  }, [router]);

  const openCloset = useCallback(() => {
    router.push('/');
  }, [router]);

  const planning = planningDates !== null;
  const planningSet = useMemo(() => new Set(planningDates ?? []), [planningDates]);

  const todayKey = toDateKey(new Date());
  const tomorrowKey = useMemo(() => {
    const now = new Date();
    return toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DayRow>) => (
      <DayCard
        date={item.date}
        weather={item.weather}
        plan={plansByDate.get(item.date) ?? null}
        itemsById={itemsById}
        unit={settings.unit}
        dressCode={dressCodes[item.date] ?? null}
        needsRegenerate={needsRegenerateFor(item.date)}
        planning={planningSet.has(item.date)}
        disabled={planning}
        relativeLabel={
          item.date === todayKey ? 'Today' : item.date === tomorrowKey ? 'Tomorrow' : undefined
        }
        onChangeDressCode={setDressCode}
        onRegenerate={regenerateDay}
      />
    ),
    [
      dressCodes,
      itemsById,
      needsRegenerateFor,
      planning,
      planningSet,
      plansByDate,
      regenerateDay,
      setDressCode,
      settings.unit,
      todayKey,
      tomorrowKey,
    ]
  );

  const closetBlocked = readiness.reason === 'no-items' || readiness.reason === 'not-enough-tagged';

  const closetEmptyState = (
    <EmptyState
      title={readiness.reason === 'no-items' ? 'Your closet is empty' : 'Not enough tagged items'}
      message={`${readiness.message} Outfit needs at least ${MIN_TAGGED_ITEMS} tagged items to plan a week.`}
      actionLabel="Go to Closet"
      onAction={openCloset}
    />
  );

  const header = (
    <View>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.location} numberOfLines={1}>
            {locationLabel(forecast?.locationName, settings.locationOverride)}
          </Text>
          <Text style={styles.forecastState} numberOfLines={1}>
            {forecastStateLabel(forecast?.fetchedAt, refreshing, forecastDays.length)}
          </Text>
        </View>

        <Pressable
          onPress={planWeek}
          disabled={planning || !readiness.ready}
          accessibilityRole="button"
          accessibilityLabel="Plan week"
          accessibilityState={{ disabled: planning || !readiness.ready, busy: planning }}
          style={({ pressed }) => [
            styles.planButton,
            {
              backgroundColor: tint,
              opacity: planning || !readiness.ready ? 0.4 : pressed ? 0.8 : 1,
            },
          ]}>
          {planning ? (
            <ActivityIndicator size="small" color={contrastOn(tint)} />
          ) : (
            <Text style={[styles.planButtonText, { color: contrastOn(tint) }]}>Plan week</Text>
          )}
        </Pressable>
      </View>

      {locationError ? (
        <ErrorBanner
          message={locationError}
          onRetry={() => void refreshForecast(true)}
          busy={refreshing}
          secondaryLabel="Set a city"
          onSecondaryAction={openSettings}
        />
      ) : null}

      {forecastError ? (
        <ErrorBanner
          message={forecastError}
          onRetry={() => void refreshForecast(true)}
          busy={refreshing}
          secondaryLabel="Set a city"
          onSecondaryAction={openSettings}
        />
      ) : null}

      {planError ? (
        <ErrorBanner
          message={planError}
          onRetry={lastRequestRef.current ? retryPlan : undefined}
          busy={planning}
        />
      ) : null}

      {/* The gate, made visible: with too few tagged items the Plan week
          button is inert and this says why. No request is ever made. */}
      {closetBlocked && rows.length > 0 ? (
        <View style={styles.inlineEmpty}>{closetEmptyState}</View>
      ) : null}
    </View>
  );

  if (rows.length === 0) {
    return (
      <View style={styles.container}>
        {header}
        {closetBlocked ? (
          closetEmptyState
        ) : (
          <EmptyState
            icon={{ ios: 'cloud.sun.fill', android: 'partly_cloudy_day', web: 'partly_cloudy_day' }}
            title="No forecast yet"
            message={
              locationError ??
              forecastError ??
              'Outfit needs your location — or a city in Settings — to fetch the week.'
            }
            actionLabel={refreshing ? 'Loading…' : 'Try again'}
            onAction={() => void refreshForecast(true)}
          />
        )}
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(row) => row.date}
      renderItem={renderItem}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refreshForecast(true)} />
      }
      initialNumToRender={4}
      windowSize={7}
    />
  );
}

/* ------------------------------------------------------------------ bits */

function locationLabel(
  forecastName: string | undefined,
  override: unknown
): string {
  const fromForecast = forecastName?.trim();
  if (fromForecast) return fromForecast;
  const place = normalizePlace(override);
  if (place) return place.name;
  return 'Location not set';
}

function forecastStateLabel(
  fetchedAt: string | undefined,
  refreshing: boolean,
  dayCount: number
): string {
  if (refreshing) return 'Updating forecast…';
  if (!fetchedAt || dayCount === 0) return 'No forecast yet';

  const parsed = Date.parse(fetchedAt);
  if (!Number.isFinite(parsed)) return 'Forecast of unknown age';

  const time = new Date(parsed).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${dayCount}-day forecast · updated ${time}`;
}

/** The dark theme's tint is white, so button text has to flip with it. */
function contrastOn(background: string): string {
  const value = background.toLowerCase();
  return value === '#fff' || value === '#ffffff' ? '#000' : '#fff';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  headerText: {
    flexShrink: 1,
    gap: 2,
  },
  location: {
    fontSize: 20,
    fontWeight: '700',
  },
  forecastState: {
    fontSize: 13,
    opacity: 0.6,
  },
  planButton: {
    minWidth: 108,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  inlineEmpty: {
    paddingTop: 20,
  },
});
