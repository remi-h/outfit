import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  PROXY_NOT_CONFIGURED_MESSAGE,
  isProxyConfigured,
  parseItemTags,
  tagImage,
  toApiError,
} from '@/src/api';
import {
  deletePhoto,
  photoExists,
  photoFileName,
  photoUriFor,
  readBase64,
} from '@/src/photos';
import { StorageKeys, load, save, type StorageKey } from '@/src/storage';
import type { ClosetItem, DayPlan, DressCodes, Forecast, ItemTags, Settings } from '@/src/types';

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
  /**
   * Why the last tagging attempt for an item did not produce tags, keyed by
   * item ID. In memory only — after a restart a `failed` item just shows a
   * generic "tap Retag" line, which is all the user can act on anyway.
   */
  tagErrors: Record<string, string>;

  addItems: (items: ClosetItem[]) => void;
  updateItem: (id: string, patch: Partial<Omit<ClosetItem, 'id'>>) => void;
  /** Deletes the photo file, the closet entry, and the ID from every plan. */
  removeItem: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  /**
   * Adds an item to the tagging queue. Safe to call repeatedly: an item that
   * is already queued or in flight is ignored. One request at a time.
   */
  tagItem: (id: string) => void;
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

const TAG_STATUSES: readonly ClosetItem['tagStatus'][] = ['pending', 'tagging', 'tagged', 'failed'];

/**
 * Decides what an item's status is at cold start.
 *
 * `tagging` can only have been written by a request that was in flight when
 * the process died — nothing is running now, and no HTTP call survives a kill
 * — so it goes back to `pending` and the Closet screen picks it up again.
 * `tagged` without usable tags is equally impossible and equally recoverable.
 */
function restoreTagStatus(status: unknown, tags: ItemTags | null): ClosetItem['tagStatus'] {
  const known = TAG_STATUSES.includes(status as ClosetItem['tagStatus'])
    ? (status as ClosetItem['tagStatus'])
    : 'pending';
  if (known === 'tagging') return 'pending';
  if (known === 'tagged' && !tags) return 'pending';
  return known;
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
      // Tags go back through the same validator as a fresh AI response, so a
      // hand-edited or half-written blob can never put a bad shape in state.
      const tags = parseItemTags(entry.tags);
      items.push({
        id: entry.id,
        photoUri: photoUriFor(fileNameOf(name)),
        createdAt:
          typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
        tags,
        tagStatus: restoreTagStatus(entry.tagStatus, tags),
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

  const [tagErrors, setTagErrors] = useState<Record<string, string>>({});

  /** Records (or clears, with `null`) the message shown for a tagging attempt. */
  const setTagError = useCallback((id: string, message: string | null) => {
    setTagErrors((prev) => {
      if (message === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id] === message) return prev;
      return { ...prev, [id]: message };
    });
  }, []);

  // Lets removeItem and the tagging queue read the closet without being
  // re-created on every change. It lags by one commit, so it is only used for
  // "does this still exist" questions, never as the source of a photo path.
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

  const removeItem = useCallback(
    (id: string) => {
      // File IO happens here rather than inside the state updater, which React
      // may run more than once.
      const target = closetRef.current.find((item) => item.id === id);
      if (target) deletePhoto(target.photoUri);

      setCloset((prev) => prev.filter((item) => item.id !== id));
      setTagError(id, null);
      setPlans((prev) =>
        prev.map((plan) =>
          plan.itemIds.includes(id)
            ? { ...plan, itemIds: plan.itemIds.filter((itemId) => itemId !== id) }
            : plan
        )
      );
    },
    [setTagError]
  );

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  /* ------------------------------------------------------- tagging queue
   *
   * IDs waiting to be tagged, plus the one currently in flight. Exactly one
   * `/tag` request runs at a time: the Worker's rate limit is shared with
   * `/plan`, and five base64 JPEGs in the air at once is how you make Expo Go
   * run out of memory. The loop lives in the provider so it keeps draining
   * while the user navigates away from the Closet tab.
   */
  const tagQueueRef = useRef<string[]>([]);
  const tagInFlightRef = useRef<string | null>(null);
  const tagDrainingRef = useRef(false);

  const drainTagQueue = useCallback(async () => {
    // A single drain loop, ever. The check and the flag are set in the same
    // synchronous block, so a second caller can never slip past it.
    if (tagDrainingRef.current) return;
    tagDrainingRef.current = true;

    try {
      for (let id = tagQueueRef.current.shift(); id != null; id = tagQueueRef.current.shift()) {
        tagInFlightRef.current = id;
        try {
          // The photo path is a pure function of the ID, so the queue never
          // has to wait for React to commit a freshly added item before it can
          // read the file. A missing file means the item was deleted
          // (removeItem unlinks it) — skip it.
          const photoUri =
            closetRef.current.find((candidate) => candidate.id === id)?.photoUri ??
            photoUriFor(photoFileName(id));
          if (!photoExists(photoUri)) continue;

          setTagError(id, null);
          // `updateItem` is a no-op for an ID that is no longer in the closet,
          // which is what makes "deleted while tagging" harmless.
          updateItem(id, { tagStatus: 'tagging' });

          try {
            // An unreadable file comes back empty; `tagImage` turns that into
            // a `bad_request` ApiError rather than a raw file-system message.
            const base64 = await readBase64(photoUri).catch(() => '');
            const tags = await tagImage(base64);
            updateItem(id, { tags, tagStatus: 'tagged' });
          } catch (error) {
            const apiError = toApiError(error);
            console.warn(`[tagging] ${id} failed (${apiError.code})`, apiError.message);
            // No auto-retry: a failed item waits for the Retag button.
            updateItem(id, { tagStatus: 'failed' });
            // Don't keep a message for an item deleted mid-request.
            if (closetRef.current.some((candidate) => candidate.id === id)) {
              setTagError(id, apiError.message);
            }
          }
        } finally {
          tagInFlightRef.current = null;
        }

        // Hand a frame back to the UI between items.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      tagDrainingRef.current = false;
    }
  }, [updateItem, setTagError]);

  const tagItem = useCallback(
    (id: string) => {
      if (tagInFlightRef.current === id || tagQueueRef.current.includes(id)) return;
      // Deliberately no closet lookup: the Closet screen enqueues an item in
      // the same tick it adds it, and React has not committed that state yet.
      // The drain loop validates against the photo file instead.

      if (!isProxyConfigured()) {
        // Nothing to call. Leave the item where the user can retry it later
        // rather than burning it to `failed` for a missing .env value.
        const status = closetRef.current.find((candidate) => candidate.id === id)?.tagStatus;
        if (status === 'failed' || status === 'tagging') {
          updateItem(id, { tagStatus: 'pending' });
        }
        setTagError(id, PROXY_NOT_CONFIGURED_MESSAGE);
        return;
      }

      setTagError(id, null);
      tagQueueRef.current.push(id);
      void drainTagQueue();
    },
    [drainTagQueue, setTagError, updateItem]
  );

  return (
    <AppStateContext.Provider
      value={{
        hydrated,
        closet,
        plans,
        settings,
        forecast,
        dressCodes,
        tagErrors,
        addItems,
        updateItem,
        removeItem,
        setSettings,
        tagItem,
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
