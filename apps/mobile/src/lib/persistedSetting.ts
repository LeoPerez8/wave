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
}

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

  const set = (value: A): void => {
    if (equals(value, get())) return;
    current = value;
    if (persistDelayMs === undefined) persist();
    else {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(persist, persistDelayMs);
    }
    onValue?.(value);
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { get, set, useValue: () => useSyncExternalStore(subscribe, get) };
}
