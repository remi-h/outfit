import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * One AsyncStorage key per slice of app state. The whole slice is stored as a
 * single JSON blob — the data is tiny (tens of items, 7 plans) so there is
 * nothing to gain from a real database.
 */
export const StorageKeys = {
  closet: 'closet',
  plans: 'plans',
  settings: 'settings',
  forecast: 'forecast',
  dressCodes: 'dressCodes',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

/**
 * Reads and JSON-parses a slice. Never throws: a missing key, unreadable
 * storage or corrupt JSON all resolve to `fallback`, so a cold start (or a
 * half-written blob) can't take the app down.
 */
export async function load<T>(key: StorageKey, fallback: T): Promise<T> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error) {
    console.warn(`[storage] could not read "${key}"`, error);
    return fallback;
  }

  if (raw == null) return fallback;

  try {
    const parsed = JSON.parse(raw) as T | null;
    return parsed == null ? fallback : parsed;
  } catch (error) {
    console.warn(`[storage] corrupt JSON in "${key}", falling back to default`, error);
    return fallback;
  }
}

/** JSON-encodes and writes a slice. Never throws; failures are logged. */
export async function save<T>(key: StorageKey, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[storage] could not write "${key}"`, error);
  }
}
