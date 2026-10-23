import { makeExternalStore } from "../lib/externalStore.ts";

export interface AllFilesAccessState {
  readonly granted: boolean;
  /** True once the user went to settings and came back without granting access. */
  readonly denied: boolean;
  /** True while Android is asked to open its settings screen. */
  readonly opening: boolean;
  /** True when Android couldn't open its settings screen, until access is granted. */
  readonly failed: boolean;
}

const same = (a: AllFilesAccessState, b: AllFilesAccessState): boolean =>
  a.granted === b.granted &&
  a.denied === b.denied &&
  a.opening === b.opening &&
  a.failed === b.failed;

/**
 * Whether Wave holds all-files access, and the request for it: the access
 * screen's Android boundary. [recheck] runs when Wave is active again, which is
 * how a grant (or a return without one) from system settings is noticed. An
 * unchanged answer notifies nobody, so coming back to Wave re-renders nothing.
 */
export const createAllFilesAccess = (android: {
  readonly hasAccess: () => boolean;
  readonly openSettings: () => Promise<void>;
}) => {
  const state = makeExternalStore<AllFilesAccessState>({
    granted: android.hasAccess(),
    denied: false,
    opening: false,
    failed: false,
  });
  const update = (change: Partial<AllFilesAccessState>): void => {
    const next = { ...state.get(), ...change };
    if (!same(next, state.get())) state.set(next);
  };
  let requested = false;

  return {
    get: state.get,
    subscribe: state.subscribe,
    recheck: (): void => {
      const granted = android.hasAccess();
      const previous = state.get();
      update({
        granted,
        denied: !granted && (requested || previous.denied),
        failed: !granted && previous.failed,
      });
      requested = false;
    },
    /** Opens Android's settings once, however often it's tapped while Android answers. */
    request: async (): Promise<void> => {
      if (state.get().opening || state.get().granted) return;
      requested = true;
      update({ opening: true, failed: false });
      try {
        await android.openSettings();
      } catch {
        // Nothing opened, so coming back isn't a denial.
        requested = false;
        update({ failed: true });
      } finally {
        update({ opening: false });
      }
    },
  };
};
