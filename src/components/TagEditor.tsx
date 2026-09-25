import { useCallback } from 'react';
import { Pressable, StyleSheet, Switch, TextInput } from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import { CATEGORIES, FORMALITIES, SEASONS, WARMTH_LEVELS } from '@/src/api';
import type { ItemTags, Season } from '@/src/types';

/** What a manually-tagged item starts from when the AI never produced tags. */
export const DEFAULT_TAGS: ItemTags = {
  category: 'top',
  color: '',
  warmth: 3,
  formality: 'casual',
  rainproof: false,
  season: ['spring', 'summer', 'autumn', 'winter'],
};

const WARMTH_HINT: Record<ItemTags['warmth'], string> = {
  1: 'very light',
  2: 'light',
  3: 'mid',
  4: 'warm',
  5: 'very warm',
};

/**
 * Edits one item's tags. Fully controlled: every change is handed straight to
 * `onChange`, which the detail screen writes through `updateItem` — so an edit
 * is persisted the moment it is made and survives a restart, with no Save
 * button to forget.
 */
export default function TagEditor({
  tags,
  onChange,
}: {
  tags: ItemTags;
  onChange: (tags: ItemTags) => void;
}) {
  const patch = useCallback(
    (next: Partial<ItemTags>) => onChange({ ...tags, ...next }),
    [tags, onChange]
  );

  const toggleSeason = useCallback(
    (season: Season) => {
      const selected = tags.season.includes(season);
      // The schema requires at least one season, so the last one can't be
      // turned off — the tap is simply ignored.
      if (selected && tags.season.length === 1) return;
      const next = selected
        ? tags.season.filter((entry) => entry !== season)
        : SEASONS.filter((entry) => entry === season || tags.season.includes(entry));
      patch({ season: next });
    },
    [tags.season, patch]
  );

  const setWarmth = useCallback(
    (delta: number) => {
      const next = Math.min(5, Math.max(1, tags.warmth + delta)) as ItemTags['warmth'];
      if (next !== tags.warmth) patch({ warmth: next });
    },
    [tags.warmth, patch]
  );

  return (
    <View style={styles.container}>
      <Field label="Category">
        <ChipRow
          options={CATEGORIES}
          isSelected={(option) => option === tags.category}
          onPress={(option) => patch({ category: option })}
        />
      </Field>

      <Field label="Colour">
        <ColourInput value={tags.color} onChange={(color) => patch({ color })} />
      </Field>

      <Field label="Warmth">
        <Stepper
          value={tags.warmth}
          hint={WARMTH_HINT[tags.warmth]}
          min={WARMTH_LEVELS[0]}
          max={WARMTH_LEVELS[WARMTH_LEVELS.length - 1]}
          onStep={setWarmth}
        />
      </Field>

      <Field label="Formality">
        <ChipRow
          options={FORMALITIES}
          isSelected={(option) => option === tags.formality}
          onPress={(option) => patch({ formality: option })}
        />
      </Field>

      <Field label="Seasons">
        <ChipRow
          options={SEASONS}
          isSelected={(option) => tags.season.includes(option)}
          onPress={toggleSeason}
        />
      </Field>

      <View style={styles.switchRow}>
        <Text style={styles.label}>Rainproof</Text>
        <Switch value={tags.rainproof} onValueChange={(rainproof) => patch({ rainproof })} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ pieces */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function ChipRow<T extends string>({
  options,
  isSelected,
  onPress,
}: {
  options: readonly T[];
  isSelected: (option: T) => boolean;
  onPress: (option: T) => void;
}) {
  const tint = useThemeColor({}, 'tint');
  const text = useThemeColor({}, 'text');

  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const selected = isSelected(option);
        return (
          <Pressable
            key={option}
            onPress={() => onPress(option)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: selected ? tint : 'rgba(127,127,127,0.5)',
                backgroundColor: selected ? tint : 'transparent',
                opacity: pressed ? 0.6 : 1,
              },
            ]}>
            <Text style={[styles.chipText, { color: selected ? contrastOn(tint) : text }]}>
              {capitalise(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({
  value,
  hint,
  min,
  max,
  onStep,
}: {
  value: number;
  hint: string;
  min: number;
  max: number;
  onStep: (delta: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <StepButton label="−" disabled={value <= min} onPress={() => onStep(-1)} />
      <View style={styles.stepperValue}>
        <Text style={styles.stepperNumber}>{value}</Text>
        <Text style={styles.stepperHint}>{hint}</Text>
      </View>
      <StepButton label="+" disabled={value >= max} onPress={() => onStep(1)} />
    </View>
  );
}

function StepButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const tint = useThemeColor({}, 'tint');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase warmth' : 'Decrease warmth'}
      style={({ pressed }) => [
        styles.stepButton,
        { borderColor: tint, opacity: disabled ? 0.3 : pressed ? 0.6 : 1 },
      ]}>
      <Text style={[styles.stepButtonText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

function ColourInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const text = useThemeColor({}, 'text');
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="e.g. navy"
      placeholderTextColor="rgba(127,127,127,0.8)"
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="done"
      maxLength={40}
      accessibilityLabel="Colour"
      style={[styles.input, { color: text }]}
    />
  );
}

/* ------------------------------------------------------------------ helpers */

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The dark theme's tint is white, so selected-chip text has to flip with it. */
function contrastOn(background: string): string {
  return background.toLowerCase() === '#fff' || background.toLowerCase() === '#ffffff'
    ? '#000'
    : '#fff';
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 18,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 26,
  },
  stepperValue: {
    minWidth: 96,
    alignItems: 'center',
  },
  stepperNumber: {
    fontSize: 20,
    fontWeight: '700',
  },
  stepperHint: {
    fontSize: 12,
    opacity: 0.6,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.5)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
