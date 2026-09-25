import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { deletePhoto, photoExists, photoUriFor } from '@/src/photos';
import { StorageKeys, load, save, type StorageKey } from '@/src/storage';
import type { ClosetItem, DayPlan, DressCodes, Forecast, Settings } from '@/src/types';

export const DEFAULT_SETTINGS: Settings = {
  unit: 'C',
  stylePreference: '',
  locationOverride: null,
};

interface AppState {
  /** False until the first read from AsyncStorage has finished. */
  hydrated: boolean;
  closet: ClosetItem[];
  plans: DayPlan[];
  settings: Settings;
  forecast: Forecast | null;
  dressCodes: DressCodes;

  addItems: (items: ClosetItem[]) => void;
  updateItem: (id: string, patch: Partial<Omit<ClosetItem, 'id'>>) => void;
  /** Deletes the photo file, the closet entry, and the ID from every plan. */
  removeItem: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
}

const AppStateContext = createContext<AppState | null>(null);

/* ------------------------------------------------------- photo path policy
 *
 * iOS can move the app container between launches, which makes an absolute
 * `file:///var/mobile/Containers/Data/Application/<UUID>/Documents/...` path
 * recorded today invalid tomorrow. So the *persisted* form of a photo is only
 * its file name; the absolute URI is rebuilt from the current document
 * directory every time we hydrate. `ClosetItem.photoUri` stays absolute in
 * memory, which is what expo-image and readBase64 want.
 */

type StoredClosetItem = Omit<ClosetItem, 'photoUri'> & { photoFile: string };

function fileNameOf(uriOrName: string): string {
  const last = uriOrName.split('/').pop();
  return last && last.length > 0 ? last : uriOrName;
}

function serializeCloset(items: ClosetItem[]): StoredClosetItem[] {
  return items.map(({ photoUri, ...rest }) => ({ ...rest, photoFile: fileNameOf(photoUri) }));
}

function deserializeCloset(stored: unknown): ClosetItem[] {
  if (!Array.isArray(stored)) return [];

  const items: ClosetItem[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<StoredClosetItem> & { photoUri?: string };
    // `photoUri` is tolerated so an older blob written with an absolute path
    // still loads; only the file name is ever used.
    const name = entry.photoFile ?? entry.photoUri;
    if (typeof entry.id !== 'string' || typeof name !== 'string') continue;

    try {
      items.push({
        id: entry.id,
        photoUri: photoUriFor(fileNameOf(name)),
        createdAt:
          typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
        tags: entry.tags ?? null,
        tagStatus: entry.tagStatus ?? 'pending',
      });
    } catch (error) {
      // An unusable file name (path validation throws) just drops the entry.
      console.warn('[store] skipping closet entry with bad photo path', name, error);
    }
  }
  return items;
}

/* ---------------------------------------------------------------- provider */

/**
 * Write-through persistence for one slice. Skips the render in which
 * `hydrated` flips to true so loading never immediately re-saves what it
 * just read.
 */
function usePersist<T, S>(
  key: StorageKey,
  value: T,
  hydrated: boolean,
  serialize: (value: T) => S
) {
  const skipNextWrite = useRef(true);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    void save(key, serialize(value));
    // `serialize` is a module-level function; excluded on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, hydrated]);
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [closet, setCloset] = useState<ClosetItem[]>([]);
  const [plans, setPlans] = useState<DayPlan[]>([]);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [dressCodes, setDressCodes] = useState<DressCodes>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [storedCloset, storedPlans, storedSettings, storedForecast, storedDressCodes] =
          await Promise.all([
            load<unknown>(StorageKeys.closet, []),
            load<unknown>(StorageKeys.plans, []),
            load<unknown>(StorageKeys.settings, {}),
            load<Forecast | null>(StorageKeys.forecast, null),
            load<unknown>(StorageKeys.dressCodes, {}),
          ]);

        if (cancelled) return;

        // Drop entries whose file is gone (deleted out from under us, or the
        // app container moved and the photo was never copied across).
        const items = deserializeCloset(storedCloset).filter((item) => photoExists(item.photoUri));
        const liveIds = new Set(items.map((item) => item.id));

        setCloset(items);
        setPlans(
          (Array.isArray(storedPlans) ? (storedPlans as DayPlan[]) : [])
            .filter((plan): plan is DayPlan => !!plan && typeof plan === 'object')
            .map((plan) => ({
              ...plan,
              itemIds: (Array.isArray(plan.itemIds) ? plan.itemIds : []).filter((id) =>
                liveIds.has(id)
              ),
            }))
        );
        setSettingsState({ ...DEFAULT_SETTINGS, ...asRecord<Partial<Settings>>(storedSettings) });
        setForecast(storedForecast ?? null);
        setDressCodes(asRecord<DressCodes>(storedDressCodes));
      } catch (error) {
        // Nothing here should throw, but a hydrate that dies would leave the
        // app stuck behind the splash screen. Start empty instead.
        console.warn('[store] hydrate failed, starting with defaults', error);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  usePersist(StorageKeys.closet, closet, hydrated, serializeCloset);
  usePersist(StorageKeys.plans, plans, hydrated, identity);
  usePersist(StorageKeys.settings, settings, hydrated, identity);
  usePersist(StorageKeys.forecast, forecast, hydrated, identity);
  usePersist(StorageKeys.dressCodes, dressCodes, hydrated, identity);

  // Lets removeItem find the photo to delete without re-creating the callback.
  const closetRef = useRef<ClosetItem[]>(closet);
  useEffect(() => {
    closetRef.current = closet;
  }, [closet]);

  const addItems = useCallback((items: ClosetItem[]) => {
    if (items.length === 0) return;
    setCloset((prev) => [...items, ...prev]);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<Omit<ClosetItem, 'id'>>) => {
    setCloset((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const removeItem = useCallback((id: string) => {
    // File IO happens here rather than inside the state updater, which React
    // may run more than once.
    const target = closetRef.current.find((item) => item.id === id);
    if (target) deletePhoto(target.photoUri);

    setCloset((prev) => prev.filter((item) => item.id !== id));
    setPlans((prev) =>
      prev.map((plan) =>
        plan.itemIds.includes(id)
          ? { ...plan, itemIds: plan.itemIds.filter((itemId) => itemId !== id) }
          : plan
      )
    );
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <AppStateContext.Provider
      value={{
        hydrated,
        closet,
        plans,
        settings,
        forecast,
        dressCodes,
        addItems,
        updateItem,
        removeItem,
        setSettings,
      }}>
      {children}
    </AppStateContext.Provider>
  );
}

function identity<T>(value: T): T {
  return value;
}

/** Narrows an unknown blob to a plain object, or `{}` if it is anything else. */
function asRecord<T extends object>(value: unknown): T {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : ({} as T);
}

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState must be used inside <AppStateProvider>');
  return state;
}
