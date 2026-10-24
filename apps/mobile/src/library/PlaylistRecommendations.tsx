import { IconPlus, IconX } from "@tabler/icons-react-native";
import {
  playlistRecommendationsSteps,
  playlistRecommendationSession,
  type PlaylistRecommendationSlot,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Animated, {
  FadeIn,
  LayoutAnimationConfig,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";

import { CELL, grid } from "@/catalog/grid";
import { ControlledTrackRowSkeleton, SkeletonGroup } from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import { artistGraphNow } from "@/home/artistGraphNow";
import { lookedUpProfileOf } from "@/home/artistGenres";
import { useScreenSight } from "@/lib/screenSight";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { recommendationTurn, recommendationTurnEffect } from "@/lib/recommendationWork";
import { runSteps } from "@/lib/stepped";
import { onArtistGraphSourcesChanged } from "@/home/graphSources";
import { afterPaint } from "@/lib/afterPaint";
import { followPlaylistRecommendations } from "./playlistRecommendationVisit";
import { playlistRecommendationInput } from "./playlistRecommendationSource";
import { makeExternalStore } from "@/lib/externalStore";
import { withRecommendationDeadline } from "@/lib/recommendationTimeout";
import { CROSSFADE_MS } from "@/motion/Crossfade";
import { WaveNative } from "@/native/waveNative";
import { playTrackIds, playYtSongs } from "@/playback/actions";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { DiscoverSongRow } from "@/ytmusic/DiscoverSongRow";

import { LibraryStore, type PlaylistEntryRow, type SongRow } from "./LibraryStore";
import { onLibraryChange } from "./libraryChanges";
import { appRuntime } from "./runtime";
import { playlistsChanged } from "./playlists";

let nextOffer = 0;

/** A replacement fades into its slot; with reduce motion on it just appears. */
const arrive = FadeIn.duration(CROSSFADE_MS).reduceMotion(ReduceMotion.Never);

/** Add and Dismiss: the controls each offer row ends with. */
const CONTROLS = 2;

/** Heard by TalkBack without moving its focus. */
const announce = (message: string): void => AccessibilityInfo.announceForAccessibility(message);

/** One controller per playlist visit; offer keys protect against stale/repeated actions. */
export function PlaylistRecommendations({
  playlistId,
  items,
}: {
  playlistId: number;
  items: readonly PlaylistEntryRow[];
}) {
  const enabled = useYtMusicEnabled();
  const sight = useScreenSight();
  const [announcingAcceptance] = useState(() => makeExternalStore(false));
  const [enabledNow] = useState(() => makeExternalStore(enabled));
  // Keep held offers readable if another offer's refill no longer finds their Library row.
  const [libraryRows] = useState(() => makeExternalStore<ReadonlyMap<string, SongRow>>(new Map()));
  const libraryById = useSyncExternalStore(libraryRows.subscribe, libraryRows.get);
  const [latestRows] = useState(() => makeExternalStore<ReadonlyMap<string, SongRow>>(new Map()));
  const [session] = useState(() =>
    playlistRecommendationSession({
      newId: () =>
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextOffer}`,
      read: (signal) =>
        appRuntime.runPromise(
          Effect.gen(function* () {
            const input = yield* playlistRecommendationInput(playlistId);
            const graph = yield* artistGraphNow;
            // Source rows are retained for the five visible offers only, never a copy of the Library.
            latestRows.set(input.songById);
            return {
              playlist: input.playlist,
              sources: {
                ...input,
                graph,
                now: Date.now(),
                profileOf: lookedUpProfileOf,
                online: WaveNative.online(),
                ytMusicEnabled: enabledNow.get(),
              },
            };
          }).pipe(withRecommendationDeadline),
          { signal },
        ),
      rank: async (input, signal) => {
        const ranked = await appRuntime
          .runPromise(
            runSteps(
              playlistRecommendationsSteps(input.playlist, input.sources),
              recommendationTurnEffect,
            ).pipe(withRecommendationDeadline),
            { signal },
          )
          .catch((error: unknown) => {
            // A cancelled rank must not keep the whole Library index reachable from this visit.
            latestRows.set(new Map());
            throw error;
          });
        const held = new Map<string, SongRow>();
        for (const offer of ranked) {
          const row = latestRows.get().get(offer.track.id);
          if (row !== undefined) held.set(offer.track.id, row);
        }
        latestRows.set(held);
        return ranked;
      },
      dismiss: (offer) =>
        appRuntime.runPromise(
          Effect.gen(function* () {
            const store = yield* LibraryStore;
            return yield* store.dismissPlaylistRecommendation(playlistId, offer);
          }),
        ),
      accept: (offer) =>
        appRuntime
          .runPromise(
            Effect.gen(function* () {
              const store = yield* LibraryStore;
              return yield* store.acceptPlaylistRecommendation(playlistId, offer);
            }),
          )
          .then((added) => {
            if (added) {
              // Both notification functions are synchronous; this Add already refills its slot.
              announcingAcceptance.set(true);
              try {
                playlistsChanged([playlistId]);
              } finally {
                announcingAcceptance.set(false);
              }
            }
            return added;
          }),
      // The tap's placeholder paints before the write; the replacement's read
      // gives rendering its frame when due (Core's `PlaylistRecommendationTurn`).
      yieldTurn: (kind) => (kind === "paint" ? afterPaint() : recommendationTurn()),
    }),
  );
  const state = useSyncExternalStore(session.subscribe, session.get);
  const reduceMotion = useReducedMotion();
  // What the busy slot says while its placeholder shows ("Adding Song").
  const [busyLabel, setBusyLabel] = useState("Loading another recommendation");
  // The visit follows the write's cause (#599): source changes revalidate even when playlist
  // IDs stay the same, once the playlist is in sight and settled.
  const visit = useRef<ReturnType<typeof followPlaylistRecommendations> | null>(null);
  useEffect(() => {
    const following = followPlaylistRecommendations(session, {
      playlistId,
      sight,
      start: (signal) => appRuntime.runPromise(settledTurnEffect, { signal }),
      subscribe: onLibraryChange,
      graphSources: onArtistGraphSourcesChanged,
      ignore: (change) => change.kind === "playlists" && announcingAcceptance.get(),
    });
    visit.current = following;
    return () => {
      following.dispose();
      visit.current = null;
    };
  }, [session, playlistId, sight, announcingAcceptance, visit]);
  useEffect(() => {
    enabledNow.set(enabled);
    visit.current?.invalidate();
  }, [enabled, enabledNow, visit]);
  useEffect(() => {
    libraryRows.update((previous) => {
      const held = new Map<string, SongRow>();
      const wanted = new Set(
        state.slots.flatMap((offer) => (offer?.track.source === "library" ? [offer.track.id] : [])),
      );
      // At most five lookups; don't synchronously index/copy the complete source on publication.
      for (const id of wanted) {
        const row = latestRows.get().get(id) ?? previous.get(id);
        if (row !== undefined) held.set(id, row);
      }
      return held;
    });
  }, [state.slots, libraryRows, latestRows]);
  const play = ({ track }: PlaylistRecommendationSlot) => {
    const context = { kind: "playlist", id: String(playlistId) } as const;
    if (track.source === "library") void playTrackIds([Number(track.id)], new Set(), 0, context);
    else void playYtSongs([track], 0, context);
  };
  const songs = state.slots.filter((song) => song !== null);
  // While one slot is replaced the others keep their look (no section-wide dimming); the
  // session ignores their taps until it is done, so nothing is written twice.
  const act = async (song: PlaylistRecommendationSlot, kind: "add" | "dismiss") => {
    const { title } = song.track;
    const index = state.slots.indexOf(song);
    const acting = kind === "add" ? session.accept(song.key) : session.dismiss(song.key);
    // The session publishes the slot's placeholder synchronously when it takes the tap.
    if (session.get().pending !== song.key) return;
    const label = kind === "add" ? `Adding ${title}` : `Dismissing ${title}`;
    setBusyLabel(label);
    announce(label);
    const saved = await acting;
    const after = session.get();
    if (!saved) {
      if (after.error === "save")
        announce(`Couldn’t ${kind === "add" ? "add" : "dismiss"} ${title}. Try again.`);
      return;
    }
    const done = kind === "add" ? `Added ${title} to the playlist.` : `Dismissed ${title}.`;
    const next = after.slots[index];
    announce(
      after.error === "refill"
        ? `${done} Couldn’t load another recommendation.`
        : next == null
          ? `${done} No more matching songs right now.`
          : `${done} Next recommendation: ${next.track.title}.`,
    );
  };
  const retryRefill = () => {
    setBusyLabel("Loading another recommendation");
    void session.renew({ refillOnly: true }).then(() => {
      const after = session.get();
      announce(
        after.error === "refill"
          ? "Couldn’t load another recommendation."
          : "Recommendations updated.",
      );
    });
  };
  const offerRow = (song: PlaylistRecommendationSlot) => {
    const local = libraryById.get(song.track.id);
    const row =
      song.track.source === "stream"
        ? { source: "stream" as const, song: song.track }
        : local === undefined
          ? null
          : { source: "library" as const, track: local };
    return (
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <View className="flex-1">
          {row !== null && <DiscoverSongRow song={row} onPress={() => play(song)} />}
        </View>
        <IconButton
          icon={IconPlus}
          label={`Add ${song.track.title} to playlist`}
          disabled={state.loading}
          onPress={() => {
            void act(song, "add");
          }}
        />
        <IconButton
          icon={IconX}
          label={`Dismiss ${song.track.title} recommendation`}
          disabled={state.loading}
          onPress={() => {
            void act(song, "dismiss");
          }}
        />
      </View>
    );
  };
  // Each slot keeps its place: an offer, its same-size placeholder while it is replaced, or
  // (its replacement failed) a retry of the same height. An exhausted slot leaves the list.
  const slotContent = (song: PlaylistRecommendationSlot | null, index: number) => {
    if (state.pendingSlots.includes(index))
      return {
        key: `pending-${index}`,
        placeholder: true,
        node: (
          <View accessible accessibilityLabel={busyLabel} accessibilityState={{ busy: true }}>
            <ControlledTrackRowSkeleton controls={CONTROLS} />
          </View>
        ),
      };
    if (song === null && state.unfilled.includes(index))
      return {
        key: `unfilled-${index}`,
        placeholder: true,
        node: (
          <View
            className="flex-row items-center justify-between"
            style={{ height: grid.row, gap: CELL * 2 }}
          >
            <Text
              accessibilityLiveRegion="polite"
              className="flex-1 font-sans text-subheadline text-secondary"
            >
              Your choice was saved. Couldn’t load another recommendation.
            </Text>
            <TextButton label="Try Again" onPress={retryRefill} />
          </View>
        ),
      };
    if (song === null) return null;
    return { key: song.key, placeholder: false, node: offerRow(song) };
  };
  const shownSlots = state.slots.flatMap((song, index) => {
    const content = slotContent(song, index);
    return content === null ? [] : [content];
  });
  return (
    <TitledSection
      title="Recommended songs"
      status={state.loading ? "Loading…" : undefined}
      action={
        state.error === "load"
          ? {
              label: "Try Again",
              onPress: () => {
                void session.renew();
              },
            }
          : undefined
      }
    >
      {state.loading && songs.length === 0 ? (
        <SkeletonGroup label="Loading recommended songs">
          {Array.from({ length: 5 }, (_, i) => (
            <ControlledTrackRowSkeleton key={i} controls={CONTROLS} />
          ))}
        </SkeletonGroup>
      ) : (
        <LayoutAnimationConfig skipEntering>
          {shownSlots.map(({ key, placeholder, node }) => (
            // A tap swaps to the placeholder at once; what replaces it fades in, in place.
            <Animated.View key={key} entering={placeholder || reduceMotion ? undefined : arrive}>
              {node}
            </Animated.View>
          ))}
        </LayoutAnimationConfig>
      )}
      {(state.error === "save" || state.error === "load") && (
        <Text
          accessibilityLiveRegion="polite"
          className="font-sans text-subheadline text-secondary"
        >
          {state.error === "save"
            ? "Couldn’t save your choice. Try the song’s action again."
            : "Couldn’t load recommendations. Try again."}
        </Text>
      )}
      {!state.loading && state.error === null && shownSlots.length === 0 && (
        <Text className="font-sans text-subheadline text-secondary">
          {items.length === 0
            ? "Add songs to get recommendations for this playlist."
            : "No more matching songs right now."}
        </Text>
      )}
    </TitledSection>
  );
}
