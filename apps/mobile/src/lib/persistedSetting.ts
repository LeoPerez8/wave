import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

/** A setting kept in the key-value store, readable from React and from plain code. */
export interface PersistedSetting<A> {
  /** The current value (read from storage the first time it's asked for). */
  readonly get: () => A;
  /** Saves `value` and tells every reader; a value equal to the current one does nothing. */
  readonly set: (value: A) => void;
  /** The current value; re-renders when it changes. */
  readonly useValue: () => A;
}

export interface PersistedSettingOptions<A> {
  readonly key: string;
  /** The value from what's stored (null when nothing is); Core's readers fall back to defaults. */
  readonly read: (stored: string | null) => A;
  /** What to store; null removes the key. */
  readonly write: (value: A) => string | null;
  readonly equals?: (a: A, b: A) => boolean;
  /** Waits this long after the last change before writing, so a dragged slider doesn't hit storage every frame. */
  readonly persistDelayMs?: number;
  /** Runs with the first value read and with every change (e.g. to apply it). */
  readonly onValue?: (value: A) => void;
  /**
   * A preference the Wave account keeps (docs/spec.md, "Wave account and
   * sync"): every change is told to `onSyncedSettingChange`'s listener, and
   * the account reads and applies it by key (`syncedSettingValue`,
   * `applySyncedSetting`).
   */
  readonly synced?: boolean;
  /**
   * Runs with every value pulled from the Wave account (`applySyncedSetting`),
   * changed or not, before it's saved: for a synced setting whose value also
   * lives elsewhere and takes more than `onValue` to follow (Download in best
   * quality's native switch).
   */
  readonly onApplied?: (value: A) => void;
}

let syncedChange: ((key: string) => void) | null = null;

/**
 * Tells [listener] the key of every synced setting (`synced`) the owner
 * changes, as it changes: the Library store stamps it for the Wave account.
 */
export const onSyncedSettingChange = (listener: (key: string) => void): void => {
  syncedChange = listener;
};

/**
 * Tells `onSyncedSettingChange`'s listener the owner chose the synced setting
 * [key]'s value again here, unchanged: for a setting whose value also lives
 * elsewhere, so the choice still beats an older one from another phone
 * (Download in best quality, whose synced copy a phone from before it never set).
 */
export const stampSyncedSetting = (key: string): void => syncedChange?.(key);

/** A synced setting as the Wave account reads and writes it: what's stored for it. */
interface SyncedSetting {
  readonly stored: () => string | null;
  readonly apply: (stored: string | null) => void;
}

/** Every synced setting made so far, by key. */
const syncedSettings = new Map<string, SyncedSetting>();

/**
 * What the key-value store holds for the synced setting [key] (null: nothing,
 * its default), as the Wave account keeps it: the value being written too.
 */
export const syncedSettingValue = (key: string): string | null =>
  syncedSettings.get(key)?.stored() ?? Storage.getItemSync(key);

/**
 * Applies a synced setting's value from the Wave account ([stored], as the
 * key-value store holds it): saved and shown at once, as a change in Settings
 * is, but not told to `onSyncedSettingChange`'s listener, as it wasn't made
 * here. False when no setting has [key] (one a newer Wave syncs).
 */
export const applySyncedSetting = (key: string, stored: string | null): boolean => {
  const setting = syncedSettings.get(key);
  setting?.apply(stored);
  return setting !== undefined;
};

/** Equality for settings stored as flat records: every field the same. */
export const sameFields = <A extends object>(a: A, b: A): boolean =>
  (Object.keys(a) as (keyof A)[]).every((field) => Object.is(a[field], b[field]));

export function persistedSetting<A>({
  key,
  read,
  write,
  equals = Object.is,
  persistDelayMs,
  onValue,
  synced = false,
  onApplied,
}: PersistedSettingOptions<A>): PersistedSetting<A> {
  let loaded = false;
  let current: A;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const get = (): A => {
    if (!loaded) {
      current = read(Storage.getItemSync(key));
      loaded = true;
      onValue?.(current);
    }
    return current;
  };

  const persist = (): void => {
    pending = undefined;
    const stored = write(current);
    if (stored === null) Storage.removeItemSync(key);
    else Storage.setItemSync(key, stored);
  };

  const change = (value: A, here: boolean): void => {
    if (equals(value, get())) return;
    current = value;
    if (pending !== undefined) clearTimeout(pending);
    // A value from the Wave account is written at once: no drag to wait out.
    if (persistDelayMs === undefined || !here) persist();
    else pending = setTimeout(persist, persistDelayMs);
    onValue?.(value);
    if (synced && here) syncedChange?.(key);
    for (const listener of listeners) listener();
  };

  const set = (value: A): void => change(value, true);

  if (synced) {
    syncedSettings.set(key, {
      stored: () => write(get()),
      apply: (stored) => {
        const value = read(stored);
        onApplied?.(value);
        change(value, false);
      },
    });
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { get, set, useValue: () => useSyncExternalStore(subscribe, get) };
}
