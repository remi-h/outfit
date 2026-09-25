import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import OutfitCollage, { resolveOutfitItems } from '@/src/components/OutfitCollage';
import type { ClosetItem, DayForecast, DayPlan, Formality, Settings } from '@/src/types';
import { toDisplayTemp, unitSuffix, wmoToIcon } from '@/src/weather';

/**
 * One day of the week: forecast, dress-code chips, the outfit, and a way to
 * ask for a different one.
 *
 * The card never calls the AI itself — every action is handed up to
 * `app/(tabs)/week.tsx`, which owns the single in-flight request. Changing a
 * dress-code chip only writes to `dressCodes`; the card then says "needs
 * regenerate" and waits for the button, per plan.md.
 */

/* ----------------------------------------------------------------- chips */

const DRESS_CODES: readonly { label: string; value: Formality | null }[] = [
  { label: 'None', value: null },
  { label: 'Casual', value: 'casual' },
  { label: 'Smart', value: 'smart' },
  { label: 'Formal', value: 'formal' },
];

/* ------------------------------------------------------------------ dates */

/**
 * `YYYY-MM-DD` → a local `Date`. Built from the parts rather than
 * `new Date(string)`, which parses a bare date as **UTC** and would show the
 * previous day for anyone west of Greenwich.
 */
function parseDateKey(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date: string): string {
  const parsed = parseDateKey(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------------ props */

export interface DayCardProps {
  /** Comes from `forecast.days[].date`, not from the phone's calendar. */
  date: string;
  /** Null when the forecast failed or is for a week we no longer have. */
  weather: DayForecast | null;
  plan: DayPlan | null;
  itemsById: ReadonlyMap<string, ClosetItem>;
  unit: Settings['unit'];
  dressCode: Formality | null;
  /** True when the stored outfit no longer matches the chosen dress code. */
  needsRegenerate: boolean;
  /** This card is part of the request currently in flight. */
  planning: boolean;
  /** Some request is in flight; every button is inert until it lands. */
  disabled: boolean;
  /** "Today", "Tomorrow", or empty — computed once by the screen. */
  relativeLabel?: string;
  onChangeDressCode: (date: string, formality: Formality | null) => void;
  onRegenerate: (date: string) => void;
}

function DayCardView({
  date,
  weather,
  plan,
  itemsById,
  unit,
  dressCode,
  needsRegenerate,
  planning,
  disabled,
  relativeLabel,
  onChangeDressCode,
  onRegenerate,
}: DayCardProps) {
  const text = useThemeColor({}, 'text');

  // Resolved through the closet map, so a deleted item is already gone from
  // the count — that is what makes "fewer than 2 items" mean what it says.
  const items = resolveOutfitItems(plan?.itemIds, itemsById);
  const failed = plan?.status === 'failed';
  const thin = !failed && items.length > 0 && items.length < 2;
  const empty = !failed && items.length === 0;

  return (
    <View
      style={styles.card}
      lightColor="rgba(120,120,128,0.08)"
      darkColor="rgba(120,120,128,0.18)">
      <View style={styles.headerRow} lightColor="transparent" darkColor="transparent">
        <View style={styles.dateBlock} lightColor="transparent" darkColor="transparent">
          <Text style={styles.date}>{formatDate(date)}</Text>
          {relativeLabel ? <Text style={styles.relative}>{relativeLabel}</Text> : null}
        </View>
        <Weather weather={weather} unit={unit} tint={text} />
      </View>

      <View style={styles.chipRow} lightColor="transparent" darkColor="transparent">
        {DRESS_CODES.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            selected={dressCode === option.value}
            // Chips stay live while planning: picking one is local state, and
            // the card the user is waiting on is the one they are dressing.
            onPress={() => onChangeDressCode(date, option.value)}
          />
        ))}
      </View>

      {needsRegenerate && !planning ? (
        <Text style={styles.needsRegenerate}>
          Dress code changed — regenerate to match it.
        </Text>
      ) : null}

      {planning ? (
        <View style={styles.busy} lightColor="transparent" darkColor="transparent">
          <ActivityIndicator size="small" />
          <Text style={styles.busyText}>Planning…</Text>
        </View>
      ) : (
        <>
          {failed ? (
            <Text style={styles.failure}>
              {plan?.reason?.trim() || 'That outfit broke the rules twice. Try again.'}
            </Text>
          ) : (
            <>
              <OutfitCollage itemIds={plan?.itemIds} itemsById={itemsById} />
              {empty ? (
                <Text style={styles.hint}>No outfit yet.</Text>
              ) : thin ? (
                <Text style={styles.hint}>
                  Only one item left for this day — regenerate for a full outfit.
                </Text>
              ) : plan?.reason?.trim() ? (
                <Text style={styles.reason} numberOfLines={2}>
                  {plan.reason.trim()}
                </Text>
              ) : null}
            </>
          )}

          <View style={styles.footer} lightColor="transparent" darkColor="transparent">
            <Pressable
              onPress={() => onRegenerate(date)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${empty ? 'Plan' : 'Regenerate'} ${formatDate(date)}`}
              accessibilityState={{ disabled }}
              style={({ pressed }) => [
                styles.regenerate,
                { borderColor: text, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
              ]}>
              <Text style={styles.regenerateText}>{empty ? 'Plan this day' : 'Regenerate'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- weather */

function Weather({
  weather,
  unit,
  tint,
}: {
  weather: DayForecast | null;
  unit: Settings['unit'];
  tint: string;
}) {
  if (!weather) {
    return (
      <View style={styles.weather} lightColor="transparent" darkColor="transparent">
        <Text style={styles.weatherLabel}>No forecast</Text>
      </View>
    );
  }

  const icon = wmoToIcon(weather.weatherCode);
  const suffix = unitSuffix(unit);
  const high = `${toDisplayTemp(weather.tMaxC, unit)}${suffix}`;
  const low = `${toDisplayTemp(weather.tMinC, unit)}${suffix}`;

  return (
    <View
      style={styles.weather}
      lightColor="transparent"
      darkColor="transparent"
      accessibilityLabel={`${icon.label}, high ${high}, low ${low}, ${weather.rainChance} percent chance of rain`}>
      {/* expo-symbols, not Ionicons: `@expo/vector-icons` is not a dependency. */}
      <SymbolView name={icon.symbol} tintColor={tint} size={26} style={styles.symbol} />
      <Text style={styles.temps}>{`${high} / ${low}`}</Text>
      <Text style={styles.weatherLabel}>{`${icon.label} · Rain ${weather.rainChance}%`}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------- chip */

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const tint = useThemeColor({}, 'tint');
  const text = useThemeColor({}, 'text');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Dress code ${label}`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? tint : 'rgba(127,127,127,0.5)',
          backgroundColor: selected ? tint : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
      ]}>
      <Text style={[styles.chipText, { color: selected ? contrastOn(tint) : text }]}>{label}</Text>
    </Pressable>
  );
}

/** The dark theme's tint is white, so selected-chip text has to flip with it. */
function contrastOn(background: string): string {
  const value = background.toLowerCase();
  return value === '#fff' || value === '#ffffff' ? '#000' : '#fff';
}

/**
 * Seven cards re-render on every keystroke in the header otherwise. Every prop
 * is either a primitive or a value the screen memoizes.
 */
export default memo(DayCardView);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  dateBlock: {
    flexShrink: 1,
    gap: 2,
  },
  date: {
    fontSize: 17,
    fontWeight: '700',
  },
  relative: {
    fontSize: 13,
    opacity: 0.6,
  },
  weather: {
    alignItems: 'flex-end',
    gap: 2,
  },
  symbol: {
    height: 26,
    width: 30,
  },
  temps: {
    fontSize: 15,
    fontWeight: '600',
  },
  weatherLabel: {
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'right',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  needsRegenerate: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.75,
    marginTop: -4,
  },
  busy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  busyText: {
    fontSize: 14,
    opacity: 0.7,
  },
  reason: {
    fontSize: 14,
    lineHeight: 19,
    opacity: 0.85,
  },
  hint: {
    fontSize: 14,
    lineHeight: 19,
    opacity: 0.6,
  },
  failure: {
    fontSize: 14,
    lineHeight: 19,
    opacity: 0.9,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  regenerate: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regenerateText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
