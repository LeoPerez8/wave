import {
  playlistRecommendations,
  rankedPlaylistRecommendations,
  type PlaylistRecommendationSources,
  type PlaylistRecommendationTrack,
} from "./playlistRecommendations.ts";

export interface PlaylistRecommendationSlot {
  readonly key: string;
  readonly track: PlaylistRecommendationTrack;
}
export interface PlaylistRecommendationState {
  readonly slots: readonly (PlaylistRecommendationSlot | null)[];
  readonly loading: boolean;
  readonly pending: string | null;
  readonly error: "load" | "save" | "refill" | null;
}
export interface PlaylistRecommendationSessionInput {
  readonly playlist: readonly PlaylistRecommendationTrack[];
  readonly sources: PlaylistRecommendationSources;
}

/** Owns visible offers and save-before-replace ordering; storage is a system boundary. */
export const playlistRecommendationSession = (options: {
  readonly newId: () => string;
  readonly read: () => Promise<PlaylistRecommendationSessionInput>;
  readonly dismiss: (offer: PlaylistRecommendationSlot) => Promise<unknown>;
}) => {
  let state: PlaylistRecommendationState = { slots: [], loading: true, pending: null, error: null };
  const listeners = new Set<() => void>();
  const consumed: PlaylistRecommendationTrack[] = [];
  let working = false;
  const publish = (patch: Partial<PlaylistRecommendationState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const read = async () => {
    const input = await options.read();
    return { ...input, sources: { ...input.sources, exclude: consumed } };
  };
  const slot = (track: PlaylistRecommendationTrack): PlaylistRecommendationSlot => ({
    key: options.newId(),
    track,
  });
  return {
    get: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    renew: async () => {
      if (working) return;
      working = true;
      publish({ loading: true, error: null });
      try {
        const input = await read();
        const ranked = rankedPlaylistRecommendations(input.playlist, input.sources);
        const eligible = new Map(ranked.map((x) => [x.track.id, x.track]));
        const slots = Array.from({ length: 5 }, (_, index) => {
          const previous = state.slots[index];
          const track = previous == null ? undefined : eligible.get(previous.track.id);
          return track === undefined || previous == null
            ? null
            : track === previous.track
              ? previous
              : { ...previous, track };
        });
        for (let index = 0; index < slots.length; index++) {
          if (slots[index] !== null) continue;
          const held = slots.flatMap((x) => (x === null ? [] : [x.track]));
          const next = playlistRecommendations(input.playlist, {
            ...input.sources,
            exclude: [...consumed, ...held],
          })[0];
          if (next !== undefined) slots[index] = slot(next.track);
        }
        publish({ slots });
      } catch {
        publish({ error: "load" });
      } finally {
        working = false;
        publish({ loading: false });
      }
    },
    dismiss: async (key: string): Promise<boolean> => {
      const index = state.slots.findIndex((x) => x?.key === key);
      const offer = state.slots[index];
      if (working || offer == null) return false;
      working = true;
      publish({ pending: key, error: null });
      try {
        await options.dismiss(offer);
      } catch {
        working = false;
        publish({ pending: null, error: "save" });
        return false;
      }
      consumed.push(offer.track);
      const slots = [...state.slots];
      slots[index] = null;
      publish({ slots });
      try {
        const input = await read();
        const held = slots.flatMap((x) => (x === null ? [] : [x.track]));
        const next = playlistRecommendations(input.playlist, {
          ...input.sources,
          exclude: [...consumed, ...held],
        })[0];
        if (next !== undefined) slots[index] = slot(next.track);
        publish({ slots: [...slots] });
      } catch {
        publish({ error: "refill" });
      } finally {
        working = false;
        publish({ pending: null });
      }
      return true;
    },
  };
};
