import {
  playlistRecommendations,
  playlistRecordingMatch,
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
  readonly accept?: (offer: PlaylistRecommendationSlot) => Promise<unknown>;
}) => {
  let state: PlaylistRecommendationState = { slots: [], loading: true, pending: null, error: null };
  const listeners = new Set<() => void>();
  const consumed: PlaylistRecommendationTrack[] = [];
  let acceptedPlaylist: readonly PlaylistRecommendationTrack[] | undefined;
  let working = false;
  let renewalPending = false;
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
  const act = async (
    key: string,
    save: ((offer: PlaylistRecommendationSlot) => Promise<unknown>) | undefined,
    accepting = false,
  ): Promise<boolean> => {
    const index = state.slots.findIndex((x) => x?.key === key);
    const offer = state.slots[index];
    if (working || offer == null || save === undefined) return false;
    working = true;
    publish({ pending: key, error: null });
    try {
      await save(offer);
    } catch {
      working = false;
      publish({ pending: null, error: "save" });
      if (renewalPending) await session.renew();
      return false;
    }
    consumed.push(offer.track);
    const slots = [...state.slots];
    slots[index] = null;
    publish({ slots });
    try {
      const input = await read();
      if (accepting) acceptedPlaylist = input.playlist;
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
      if (renewalPending) await session.renew();
    }
    return true;
  };
  const session = {
    get: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A delayed Add notification acknowledges its refill; source changes request full renewal. */
    renew: async (
      request: { readonly ifPlaylistChanged?: boolean; readonly refillOnly?: boolean } = {},
    ): Promise<void> => {
      if (working) {
        // Source changes must survive an in-flight save/refill; Add's notification need not rerank.
        if (request.ifPlaylistChanged !== true && request.refillOnly !== true)
          renewalPending = true;
        return;
      }
      renewalPending = false;
      working = true;
      publish({ loading: true, error: null });
      try {
        const input = await read();
        const previousPlaylist = acceptedPlaylist;
        acceptedPlaylist = undefined;
        if (
          request.ifPlaylistChanged === true &&
          previousPlaylist !== undefined &&
          input.playlist.length === previousPlaylist.length &&
          input.playlist.every((track, index) => track.id === previousPlaylist[index]!.id)
        )
          return;
        // Recovery excludes held offers before the limit and only fills holes, like the action.
        const preserved = request.refillOnly
          ? state.slots.flatMap((offer) => (offer === null ? [] : [offer.track]))
          : [];
        const ranked = playlistRecommendations(input.playlist, {
          ...input.sources,
          exclude: [...consumed, ...preserved],
        });
        const eligible = new Map(ranked.map((x) => [x.track.id, x.track]));
        const slots = request.refillOnly
          ? [...state.slots]
          : Array.from({ length: 5 }, (_, index) => {
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
          const occupied = playlistRecordingMatch(held);
          const next = ranked.find((candidate) => occupied(candidate.track) === null);
          if (next !== undefined) slots[index] = slot(next.track);
        }
        publish({ slots });
      } catch {
        publish({ error: request.refillOnly ? "refill" : "load" });
      } finally {
        working = false;
        publish({ loading: false });
        if (renewalPending) await session.renew();
      }
    },
    dismiss: (key: string) => act(key, options.dismiss),
    accept: (key: string) => act(key, options.accept, true),
  };
  return session;
};
