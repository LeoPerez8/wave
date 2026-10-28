/** An observable value, as a persisted setting or an external store offers it. */
export interface Observed<A> {
  readonly get: () => A;
  readonly subscribe: (listener: () => void) => () => void;
}

/** [source]'s value as shown somewhere that can be told to keep what it shows for a while. */
export interface Holdable<A> extends Observed<A> {
  /**
   * Keeps showing the value [source] has now, whatever it changes to, until
   * every hold is released; gives the release (a second call does nothing).
   */
  readonly hold: () => () => void;
}

/**
 * Shows [source]'s value, or, while held, the value it had when the hold began
 * (Settings › Appearance holds the app's glass while the owner tunes it).
 */
export const holdable = <A>(source: Observed<A>): Holdable<A> => {
  let holds = 0;
  let held: { readonly value: A } | null = null;
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    get: () => (held === null ? source.get() : held.value),
    subscribe: (listener) => {
      listeners.add(listener);
      const stop = source.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    hold: () => {
      if (holds === 0) held = { value: source.get() };
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        if (holds > 0) return;
        held = null;
        tell();
      };
    },
  };
};
