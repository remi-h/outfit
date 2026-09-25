import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import ErrorBanner from '@/src/components/ErrorBanner';
import { geocodeResult, normalizePlace, type Place } from '@/src/location';
import { useAppState } from '@/src/store';
import type { Settings } from '@/src/types';
import { toDisplayTemp, unitSuffix } from '@/src/weather';

/** Sample value in the unit control, so "°F" means something before you tap it. */
const UNIT_SAMPLE_C = 18;

const UNITS: readonly Settings['unit'][] = ['C', 'F'];

type LookupState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'not_found'; query: string }
  | { status: 'error'; message: string; query: string };

export default function SettingsScreen() {
  const { settings, setSettings, forecast, setForecast } = useAppState();
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });

  // Not `settings.locationOverride` directly: that value comes straight out of
  // a JSON blob, and this screen reads `.name` and `.latitude` off it.
  const override = normalizePlace(settings.locationOverride);

  /**
   * Forgets a forecast fetched for somewhere else. The Week screen refetches
   * when it has none, so changing the city here is enough to change the
   * forecast there — no cross-screen signalling needed.
   */
  const dropForeignForecast = useCallback(
    (place: Place | null) => {
      if (!forecast) return;
      if (
        place &&
        Math.abs(forecast.latitude - place.latitude) <= 0.05 &&
        Math.abs(forecast.longitude - place.longitude) <= 0.05
      ) {
        return;
      }
      setForecast(null);
    },
    [forecast, setForecast]
  );

  const search = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;

      Keyboard.dismiss();
      setLookup({ status: 'searching' });

      // `geocodeResult` never throws; the try/catch is belt and braces so a
      // surprise can't leave the button spinning forever.
      let result;
      try {
        result = await geocodeResult(trimmed);
      } catch (error) {
        console.warn('[settings] geocode threw', error);
        setLookup({ status: 'error', message: "Couldn't look that up. Try again.", query: trimmed });
        return;
      }

      if (result.status === 'ok') {
        setSettings({ locationOverride: result.place });
        dropForeignForecast(result.place);
        setQuery('');
        setLookup({ status: 'idle' });
        return;
      }

      if (result.status === 'not_found') {
        setLookup({ status: 'not_found', query: trimmed });
        return;
      }

      setLookup({ status: 'error', message: result.message, query: trimmed });
    },
    [dropForeignForecast, setSettings]
  );

  const useCurrentLocation = useCallback(() => {
    setQuery('');
    setLookup({ status: 'idle' });
    if (!settings.locationOverride) return;
    setSettings({ locationOverride: null });
    // Nothing is resolved yet, so any stored forecast is by definition for the
    // override we just dropped.
    dropForeignForecast(null);
  }, [dropForeignForecast, setSettings, settings.locationOverride]);

  const searching = lookup.status === 'searching';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic">
        <Section
          title="Temperature"
          hint="Display only — outfits are always planned in °C.">
          <View style={styles.row}>
            {UNITS.map((unit) => (
              <Chip
                key={unit}
                label={`${toDisplayTemp(UNIT_SAMPLE_C, unit)}${unitSuffix(unit)}`}
                selected={settings.unit === unit}
                accessibilityLabel={unit === 'C' ? 'Celsius' : 'Fahrenheit'}
                onPress={() => setSettings({ unit })}
              />
            ))}
          </View>
        </Section>

        <Section
          title="Style preference"
          hint="Free text, passed to the AI with every plan. Saved as you type.">
          <StyleInput
            value={settings.stylePreference}
            onChange={(stylePreference) => setSettings({ stylePreference })}
          />
        </Section>

        <Section
          title="Location"
          hint="Leave this empty to use your phone's location. Outfit only asks for location when the Week screen needs a forecast.">
          <Text style={styles.status}>
            {override ? `Using ${override.name}` : 'Using your current location'}
          </Text>
          {override ? (
            <Text style={styles.coords}>
              {override.latitude.toFixed(2)}, {override.longitude.toFixed(2)}
            </Text>
          ) : null}

          <View style={styles.searchRow}>
            <CityInput
              value={query}
              editable={!searching}
              onChange={(next) => {
                setQuery(next);
                if (lookup.status !== 'idle' && lookup.status !== 'searching') {
                  setLookup({ status: 'idle' });
                }
              }}
              onSubmit={() => void search(query)}
            />
            <Button
              label="Set"
              busy={searching}
              disabled={query.trim().length === 0}
              onPress={() => void search(query)}
            />
          </View>

          {lookup.status === 'not_found' ? (
            <Text style={styles.notFound}>
              {`Couldn\u2019t find \u201c${lookup.query}\u201d. Try a city name, e.g. \u201cTokyo\u201d.`}
            </Text>
          ) : null}

          {lookup.status === 'error' ? (
            <ErrorBanner
              message={lookup.message}
              onRetry={() => void search(lookup.query)}
              busy={searching}
              style={styles.banner}
            />
          ) : null}

          <Button
            label="Use current location"
            onPress={useCurrentLocation}
            // Keyed off the raw value, not the normalized one: an unusable blob
            // reads as "no override" above but still needs clearing from here.
            disabled={!settings.locationOverride}
            wide
          />
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ------------------------------------------------------------------ pieces */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const tint = useThemeColor({}, 'tint');
  const text = useThemeColor({}, 'text');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
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

function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  wide = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  const tint = useThemeColor({}, 'tint');
  const inactive = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.button,
        wide && styles.buttonWide,
        { borderColor: tint, opacity: inactive ? 0.4 : pressed ? 0.6 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <Text style={[styles.buttonText, { color: tint }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * Controlled, with no Save button: every keystroke goes through `setSettings`,
 * which the store writes through to AsyncStorage — the same pattern
 * `TagEditor` uses, and the reason an edit survives a restart even if the user
 * force-quits straight after typing.
 */
function StyleInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const text = useThemeColor({}, 'text');
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="e.g. minimal, no bright colors"
      placeholderTextColor="rgba(127,127,127,0.8)"
      multiline
      numberOfLines={3}
      maxLength={280}
      textAlignVertical="top"
      accessibilityLabel="Style preference"
      style={[styles.input, styles.multiline, { color: text }]}
    />
  );
}

function CityInput({
  value,
  editable,
  onChange,
  onSubmit,
}: {
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const text = useThemeColor({}, 'text');
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      editable={editable}
      placeholder="City, e.g. Tokyo"
      placeholderTextColor="rgba(127,127,127,0.8)"
      autoCapitalize="words"
      autoCorrect={false}
      returnKeyType="search"
      maxLength={80}
      onSubmitEditing={onSubmit}
      accessibilityLabel="Location override"
      style={[styles.input, styles.flex, { color: text }]}
    />
  );
}

/** The dark theme's tint is white, so selected-chip text has to flip with it. */
function contrastOn(background: string): string {
  return background.toLowerCase() === '#fff' || background.toLowerCase() === '#ffffff'
    ? '#000'
    : '#fff';
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 28,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.6,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  status: {
    fontSize: 16,
    fontWeight: '600',
  },
  coords: {
    fontSize: 13,
    opacity: 0.5,
    marginTop: -6,
  },
  banner: {
    marginHorizontal: 0,
    marginTop: 0,
  },
  notFound: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.8,
  },
  chip: {
    minWidth: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
  },
  chipText: {
    fontSize: 15,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.5)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: {
    minHeight: 88,
    paddingTop: 10,
  },
  button: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonWide: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
