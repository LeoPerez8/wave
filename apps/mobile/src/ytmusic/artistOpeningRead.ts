import {
  identityKey,
  searchRoomAt,
  stepYtArtistSection,
  ytArtistOpening,
  ytArtistToggle,
  ytPopularReadDue,
  type SearchAllowance,
  type YtArtistSaved,
  type YtArtistSection,
  type YtPick,
  type YtSong,
} from "@wave/core";

/** Saved Popular is local, even offline, with YT Music off or Library selected. */
export const artistPopularSongs = <S extends YtSong>(
  state: YtArtistSection<S>,
): readonly S[] | null => {
  const saved = state.status === "reading" ? null : state.saved;
  return saved?.outcome === "found" ? (saved.page.allSongs ?? null) : null;
};

export interface ArtistOpeningContext {
  readonly enabled: boolean;
  readonly settled: boolean;
  readonly contentReady: boolean;
  readonly integrated: boolean;
  readonly always: boolean;
  readonly pick: YtPick | null;
}

/** One mounted artist page's Online read, shared by Popular and online additions. */
export const createArtistOpeningRead = <S extends YtSong>(ports: {
  readonly restore: (key: string, signal: AbortSignal) => Promise<YtArtistSaved<S> | null>;
  readonly request: (
    name: string,
    key: string,
    saved: YtArtistSaved<S> | null,
    signal: AbortSignal,
    canSend: () => boolean,
  ) => Promise<YtArtistSaved<S>>;
  readonly online: () => boolean;
  /** Live screen state closes the gap before React delivers its next effect. */
  readonly settled?: () => boolean;
  readonly allowance: () => SearchAllowance;
  /** Recheck Always on Wi-Fi at execution; explicit Online/integrated consent still stands. */
  readonly always: () => boolean;
}) => {
  let name = "";
  let snapshot: {
    readonly key: string;
    readonly state: YtArtistSection<S>;
    readonly openedAt: number;
  } = {
    key: "",
    state: { status: "reading" },
    openedAt: Date.now(),
  };
  let context: ArtistOpeningContext | null = null;
  let active = false;
  const asked = new Set<string>();
  const listeners = new Set<() => void>();
  const publish = (state: YtArtistSection<S>) => {
    snapshot = { ...snapshot, state };
    for (const listener of listeners) listener();
  };
  const eligible = () =>
    context !== null &&
    context.enabled &&
    context.contentReady &&
    context.settled &&
    (ports.settled?.() ?? true) &&
    ytArtistToggle(snapshot.state, { ...context, now: snapshot.openedAt }) === "online" &&
    (context.pick !== null || context.integrated || !context.always || ports.always());
  let retry = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = null;
  };
  const drive = () => {
    clearTimeout(timer);
    timer = undefined;
    if (context === null || !eligible() || snapshot.state.status !== "ready") return;
    if (snapshot.state.failure !== null && !retry) return;
    const options = { ...context, name, now: snapshot.openedAt, retry };
    if (!ytArtistOpening(snapshot.state, options).ask) return;
    if (!ports.online()) {
      retry = false;
      publish({ status: "ready", saved: snapshot.state.saved, failure: "offline" });
      return;
    }
    if (!retry && asked.has(snapshot.key)) {
      publish({ status: "ready", saved: snapshot.state.saved, failure: "failed" });
      return;
    }
    const freeAt = searchRoomAt(ports.allowance(), "search", Date.now());
    if (freeAt !== null) {
      timer = setTimeout(drive, Math.max(1, freeAt - Date.now()));
      return;
    }
    const saved = snapshot.state.saved;
    const needsRanking =
      saved === null || (saved.outcome === "found" && saved.page.allSongs === undefined);
    if (
      !retry &&
      needsRanking &&
      !ytPopularReadDue({
        ...options,
        onlineSelected: true,
        online: ports.online(),
        saved,
        asked,
        allowance: ports.allowance(),
        now: Date.now(),
      })
    )
      return;
    retry = false;
    asked.add(snapshot.key);
    publish(stepYtArtistSection(snapshot.state, { type: "requested" }));
    const running = new AbortController();
    controller = running;
    const current = () => controller === running && !running.signal.aborted;
    void ports
      .request(
        name,
        snapshot.key,
        saved,
        running.signal,
        () => current() && eligible() && ports.online(),
      )
      .then(
        (answer) => {
          if (current())
            publish(stepYtArtistSection(snapshot.state, { type: "answered", saved: answer }));
        },
        (error: unknown) => {
          const reason =
            typeof error === "object" &&
            error !== null &&
            "reason" in error &&
            error.reason === "offline"
              ? "offline"
              : "failed";
          if (current()) publish(stepYtArtistSection(snapshot.state, { type: "failed", reason }));
        },
      );
  };
  const update = (next: ArtistOpeningContext) => {
    if (!active) return;
    context = next;
    if (!eligible() && snapshot.state.status === "loading") {
      cancel();
      publish({ status: "ready", saved: snapshot.state.saved, failure: "failed" });
    }
    drive();
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: (nextName: string) => {
      cancel();
      if (!active) asked.clear();
      active = true;
      retry = false;
      name = nextName;
      snapshot = { key: identityKey(name), state: { status: "reading" }, openedAt: Date.now() };
      const restoring = new AbortController();
      controller = restoring;
      const restored = (saved: YtArtistSaved<S> | null) => {
        if (controller !== restoring || restoring.signal.aborted) return;
        publish({ status: "ready", saved, failure: null });
        drive();
      };
      void ports.restore(snapshot.key, restoring.signal).then(restored, () => restored(null));
    },
    update,
    pick: (pick: YtPick) => {
      if (context !== null) update({ ...context, pick });
    },
    retry: () => {
      if (!active || snapshot.state.status === "loading") return;
      retry = true;
      drive();
    },
    close: () => {
      active = false;
      context = null;
      retry = false;
      cancel();
    },
  };
};
