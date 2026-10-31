import { IconPlus, IconX } from "@tabler/icons-react-native";
import {
  playlistRecommendationsSteps,
  playlistRecommendationSession,
  playlistSuggestionsLine,
  playlistSuggestionsSightLine,
  playlistSuggestionsSightWatch,
  type PlaylistRecommendationSlot,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Animated, {
  FadeIn,
  LayoutAnimationConfig,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";

import { CELL, grid } from "@/catalog/grid";
import { useLocalisation } from "@/localisation/localisation";
import { ControlledTrackRowSkeleton, SkeletonGroup } from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import { lookedUpProfileOf } from "@/home/artistGenres";
import { useScreenSight } from "@/lib/screenSight";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { recommendationTurn, recommendationTurnEffect } from "@/lib/recommendationWork";
import { runSteps } from "@/lib/stepped";
import { afterPaint } from "@/lib/afterPaint";
import { appLog } from "@/log/appLog";
import { followPlaylistRecommendations } from "./playlistRecommendationVisit";
import {
  playlistRecommendationGraph,
  playlistRecommendationInput,
} from "./playlistRecommendationSource";
import { playlistSuggestionRadios, playlistSuggestionSeeds } from "./playlistSuggestionRadios";
import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { CROSSFADE_MS } from "@/motion/Crossfade";
import { online as phoneOnline } from "@/native/waveNative";
import { playTrackIds, playYtSongs } from "@/playback/actions";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  type ListedSong,
} from "@/songs/mixedSongs";
import { useSongRows } from "@/songs/useSongRows";

import { LibraryStore, type PlaylistEntryRow, type SongRow } from "./LibraryStore";
import { onLibraryChange } from "./libraryChanges";
import { appRuntime } from "./runtime";
import { playlistsChanged } from "./playlists";

let nextOffer = 0;

const offerKey = (song: PlaylistRecommendationSlot): string => song.key;

/** A replacement fades into its slot; with reduce motion on it just appears. */
const arrive = FadeIn.duration(CROSSFADE_MS).reduceMotion(ReduceMotion.Never);

/** Add and Dismiss: the controls each offer row ends with. */
const CONTROLS = 2;

/** Fewer eligible suggestions left than this, and a refill reads the radios' next pages. */
const LOW = 10;

/** What a slot's placeholder says while it waits for a replacement of its own. */

/** Heard by TalkBack without moving its focus. */
const announce = (message: string): void => AccessibilityInfo.announceForAccessibility(message);

/**
 * One controller per playlist visit; offer keys protect against stale/repeated
 * actions. Shown only with YT Music on: its suggestions come from radios.
 */
export function PlaylistRecommendations({
  playlistId,
  items,
  sectionSight,
}: {
  playlistId: number;
  items: readonly PlaylistEntryRow[];
  /** When the section came into sight in its list (`Date.now()`); null while it's out of sight. */
  sectionSight: ExternalStore<number | null>;
}) {
  const text = useLocalisation().strings.playlists;
  const sight = useScreenSight();
  const [announcingAcceptance] = useState(() => makeExternalStore(false));
  // Keep held offers readable if another offer's refill no longer finds their Library row.
  const [libraryRows] = useState(() => makeExternalStore<ReadonlyMap<string, SongRow>>(new Map()));
  const libraryById = useSyncExternalStore(libraryRows.subscribe, libraryRows.get);
  const [latestRows] = useState(() => makeExternalStore<ReadonlyMap<string, SongRow>>(new Map()));
  // Date.now(): the list notices the section's sight on the UI thread, whose clock is this one.
  const [sightWatch] = useState(() =>
    playlistSuggestionsSightWatch({
      now: Date.now,
      report: (timing) => appLog("info", "WaveTiming", playlistSuggestionsSightLine(timing)),
    }),
  );
  const [session] = useState(() => {
    // The first renewal is the one opening the playlist asked for; its line counts from here.
    let openedAt: number | undefined = performance.now();
    // This visit's radio readers: each radio's live first page is read once a visit.
    const visitId = `playlist:${playlistId}:${Date.now().toString(36)}-${++nextOffer}`;
    let remaining = Number.POSITIVE_INFINITY;
    return playlistRecommendationSession({
      newId: () =>
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextOffer}`,
      read: (signal) => {
        sightWatch.waiting("settle");
        return appRuntime.runPromise(
          Effect.gen(function* () {
            const input = yield* playlistRecommendationInput(playlistId, () =>
              sightWatch.waiting("read"),
            );
            const graph = yield* playlistRecommendationGraph;
            // Source rows are retained for the five visible offers only, never a copy of the Library.
            latestRows.set(input.songById);
            const seeds = playlistSuggestionSeeds(playlistId, input.playlist);
            const online = phoneOnline();
            const pages = yield* playlistSuggestionRadios(visitId, seeds, {
              online,
              low: remaining < LOW,
            });
            sightWatch.waiting(null);
            return {
              playlist: input.playlist,
              sources: {
                ...input,
                pages,
                seeds,
                graph,
                profileOf: lookedUpProfileOf,
                online,
              },
            };
          }),
          { signal },
        );
      },
      rank: async (input, signal) => {
        sightWatch.waiting("rank");
        const ranked = await appRuntime
          .runPromise(
            runSteps(
              playlistRecommendationsSteps(input.playlist, input.sources),
              recommendationTurnEffect,
            ),
            { signal },
          )
          .catch((error: unknown) => {
            // A cancelled rank must not keep the whole Library index reachable from this visit.
            latestRows.set(new Map());
            throw error;
          });
        sightWatch.waiting(null);
        remaining = ranked.length;
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
      timed: {
        now: () => performance.now(),
        report: (timing) => {
          const sinceOpen = openedAt === undefined ? undefined : performance.now() - openedAt;
          openedAt = undefined;
          appLog("info", "WaveTiming", playlistSuggestionsLine(timing, sinceOpen));
          const { offers, failed } = timing;
          void afterPaint().then(() => sightWatch.shown({ offers, failed }));
        },
      },
    });
  });
  const state = useSyncExternalStore(session.subscribe, session.get);
  const reduceMotion = useReducedMotion();
  // What a tapped slot's placeholder says until its action ends ("Adding Song"), by slot;
  // any other placeholder is loading a replacement.
  const [busyLabels, setBusyLabels] = useState<ReadonlyMap<number, string>>(new Map());
  const labelSlot = (slot: number, label: string | undefined) =>
    setBusyLabels((previous) => {
      const next = new Map(previous);
      if (label === undefined) next.delete(slot);
      else next.set(slot, label);
      return next;
    });
  // The visit follows the write's cause (#599): source changes revalidate even when playlist
  // IDs stay the same, once the playlist is in sight and settled. Catalog writes (its own
  // radios' among them) don't: the suggestions read their radios, not the catalog.
  useEffect(() => {
    const following = followPlaylistRecommendations(session, {
      playlistId,
      sight,
      start: (signal) => {
        sightWatch.waiting("settle");
        return appRuntime.runPromise(settledTurnEffect, { signal });
      },
      subscribe: onLibraryChange,
      ignore: (change) => change.kind === "playlists" && announcingAcceptance.get(),
    });
    return () => following.dispose();
  }, [session, sightWatch, playlistId, sight, announcingAcceptance]);
  // Sight here is the list's and the screen's: Now Playing over a wait starts it over.
  useEffect(() => {
    const listSight = () => {
      const at = sectionSight.get();
      if (at !== null && sight.visible()) sightWatch.inSight(at);
    };
    listSight();
    const stopList = sectionSight.subscribe(listSight);
    const stopScreen = sight.subscribe(() => {
      if (!sight.visible()) sightWatch.hidden();
      else if (sectionSight.get() !== null) sightWatch.inSight();
    });
    return () => {
      stopList();
      stopScreen();
    };
  }, [sectionSight, sight, sightWatch]);
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
  // An offer is the Library's song once read, else YT Music's, streamed.
  const listedOf = (song: PlaylistRecommendationSlot): ListedSong | null => {
    if (song.track.source === "stream") return { source: "stream", song: song.track };
    const local = libraryById.get(song.track.id);
    return local === undefined ? null : { source: "library", track: local };
  };
  const offers = useSongRows({
    data: songs,
    keyExtractor: offerKey,
    song: (song) => {
      const listed = listedOf(song);
      return listed === null ? null : mixedSongEntry(listed);
    },
    context: { kind: "playlist", id: String(playlistId) },
    onPlay: play,
    onMenu: (song, options) => {
      const listed = listedOf(song);
      if (listed !== null) openMixedSongActions(listed, options);
    },
    onSongSwipe: (song, shown) => {
      const listed = listedOf(song);
      if (listed !== null) runMixedSongSwipe(listed, shown);
    },
  });
  // While one slot is replaced the others keep their look (no section-wide dimming) and take
  // their own taps; the session saves them in turn and ignores a repeated tap on a busy offer.
  const act = async (song: PlaylistRecommendationSlot, kind: "add" | "dismiss") => {
    const { title } = song.track;
    const index = state.slots.indexOf(song);
    const busy = session.get().pending.includes(song.key);
    const acting = kind === "add" ? session.accept(song.key) : session.dismiss(song.key);
    // The session publishes the slot's placeholder synchronously when it takes the tap.
    if (busy || !session.get().pending.includes(song.key)) return;
    const label = kind === "add" ? text.adding(title) : text.dismissing(title);
    labelSlot(index, label);
    announce(label);
    const saved = await acting;
    labelSlot(index, undefined);
    const after = session.get();
    if (!saved) {
      if (after.error === "save")
        announce(kind === "add" ? text.couldntAddSong(title) : text.couldntDismissSong(title));
      return;
    }
    const done = kind === "add" ? text.addedSong(title) : text.dismissedSong(title);
    const next = after.slots[index];
    announce(
      `${done} ${
        after.unfilled.includes(index)
          ? text.couldntLoadAnother
          : next == null
            ? text.noMoreMatching
            : text.next(next.track.title)
      }`,
    );
  };
  const retryRefill = () => {
    const retrying = state.unfilled;
    void session.renew({ refillOnly: true }).then(() => {
      const after = session.get();
      announce(
        retrying.some((slot) => after.unfilled.includes(slot))
          ? text.couldntLoadAnother
          : text.recommendationsUpdated,
      );
    });
  };
  const offerRow = (song: PlaylistRecommendationSlot) => {
    return (
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <View className="flex-1">{offers.render(song, 0)}</View>
        <IconButton
          icon={IconPlus}
          label={text.addRecommendation(song.track.title)}
          disabled={state.loading}
          onPress={() => {
            void act(song, "add");
          }}
        />
        <IconButton
          icon={IconX}
          label={text.dismissRecommendation(song.track.title)}
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
          <View
            accessible
            accessibilityLabel={busyLabels.get(index) ?? text.loadingAnother}
            accessibilityState={{ busy: true }}
          >
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
              {text.savedButNoAnother}
            </Text>
            <TextButton label={text.tryAgain} onPress={retryRefill} />
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
      title={text.recommendedSongs}
      status={state.loading ? text.loading : undefined}
      action={
        state.error === "load"
          ? {
              label: text.tryAgain,
              onPress: () => {
                // Asking afresh draws other seed songs.
                void session.renew();
              },
            }
          : undefined
      }
    >
      {state.loading && songs.length === 0 ? (
        <SkeletonGroup label={text.loadingRecommended}>
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
          {state.error === "save" ? text.couldntSaveChoice : text.couldntLoadRecommendations}
        </Text>
      )}
      {!state.loading && state.error === null && shownSlots.length === 0 && (
        <Text className="font-sans text-subheadline text-secondary">
          {items.length === 0 ? text.addSongsForRecommendations : text.noMoreMatching}
        </Text>
      )}
    </TitledSection>
  );
}
