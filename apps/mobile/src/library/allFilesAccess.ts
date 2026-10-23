import { makeExternalStore } from "../lib/externalStore.ts";

export interface AllFilesAccessState {
  readonly granted: boolean;
  readonly denied: boolean;
  readonly opening: boolean;
  readonly failed: boolean;
}

/** The access screen's Android boundary; recheck on return from system settings. */
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
  let requested = false;

  return {
    get: state.get,
    subscribe: state.subscribe,
    recheck: (): void => {
      const granted = android.hasAccess();
      state.update((previous) => ({
        ...previous,
        granted,
        denied: !granted && (requested || previous.denied),
        failed: !granted && previous.failed,
      }));
      requested = false;
    },
    request: async (): Promise<void> => {
      if (state.get().opening || state.get().granted) return;
      requested = true;
      state.update((previous) => ({ ...previous, opening: true, failed: false }));
      try {
        await android.openSettings();
      } catch {
        requested = false;
        state.update((previous) => ({ ...previous, failed: true }));
      } finally {
        state.update((previous) => ({ ...previous, opening: false }));
      }
    },
  };
};
