import { IconArrowDown, IconPlus, IconX } from "@tabler/icons-react-native";
import { goToSuggestionsOffered, type PlaylistRecommendationSlot } from "@wave/core";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
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
import { FloatingPill } from "@/components/FloatingPill";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import { lookedUpProfileOf } from "@/home/artistGenres";
import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { useScreenSight } from "@/lib/screenSight";
import { CROSSFADE_MS } from "@/motion/Crossfade";
import { playTrackIds, playYtSongs } from "@/playback/actions";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  type ListedSong,
} from "@/songs/mixedSongs";
import { useSongRows } from "@/songs/useSongRows";

import type { PlaylistEntryRow } from "./LibraryStore";
import {
  createPlaylistSuggestionsVisit,
  type PlaylistSuggestionsVisit,
} from "./playlistSuggestionsVisit";

const offerKey = (song: PlaylistRecommendationSlot): string => song.key;

/** A replacement fades into its slot; with reduce motion on it just appears. */
const arrive = FadeIn.duration(CROSSFADE_MS).reduceMotion(ReduceMotion.Never);

/**
 * The section's height with its heading and five offers: what a list that never mounted it
 * should expect, so a tap can scroll the section up rather than stop at its first line.
 */
export const SUGGESTIONS_SECTION_HEIGHT = CELL * 12.5 + 5 * grid.row;

/** Add and Dismiss: the controls each offer row ends with. */
const CONTROLS = 2;

/** Heard by TalkBack without moving its focus. */
const announce = (message: string): void => AccessibilityInfo.announceForAccessibility(message);

/**
 * The suggestions of the calling screen's playlist visit. They load from the opening on,
 * while [wanted] (the list would show the section) and the screen is in sight, whether or not
 * the section ever mounts. [sectionSight] is when the section came into sight in its list
 * (`Date.now()`), null while it's out of sight. Following them renders nothing here.
 */
export const usePlaylistSuggestionsVisit = (
  playlistId: number,
  wanted: boolean,
  sectionSight: ExternalStore<number | null>,
): PlaylistSuggestionsVisit => {
  const screen = useScreenSight();
  const [visit] = useState(() => createPlaylistSuggestionsVisit(playlistId));
  const [wantedStore] = useState(() => makeExternalStore(wanted));
  useLayoutEffect(() => wantedStore.set(wanted), [wantedStore, wanted]);
  useEffect(
    () => visit.follow(screen, wantedStore, sectionSight),
    [visit, screen, wantedStore, sectionSight],
  );
  return visit;
};

/**
 * The pill that takes a long playlist to its suggestions, while the section is [away] and has
 * something to go to (offers, a load or a failure line). Following both renders only this.
 */
export function GoToSuggestions({
  visit,
  away,
  bottom,
  onPress,
}: {
  visit: PlaylistSuggestionsVisit;
  away: ExternalStore<boolean>;
  bottom: number;
  onPress: () => void;
}) {
  const { session } = visit;
  const label = useLocalisation().strings.playlists.goToSuggestions;
  const offered = useSyncExternalStore(session.subscribe, () =>
    goToSuggestionsOffered(session.get()),
  );
  const isAway = useSyncExternalStore(away.subscribe, away.get);
  if (!offered || !isAway) return null;
  return <FloatingPill icon={IconArrowDown} label={label} bottom={bottom} onPress={onPress} />;
}

/**
 * The section showing a [visit]'s offers: it holds nothing of its own, so the list can
 * recycle it away and back. Shown only with YT Music on: its suggestions come from radios.
 */
export function PlaylistRecommendations({
  playlistId,
  items,
  visit,
}: {
  playlistId: number;
  items: readonly PlaylistEntryRow[];
  visit: PlaylistSuggestionsVisit;
}) {
  const text = useLocalisation().strings.playlists;
  const { session, libraryRows, busyLabels: labels } = visit;
  const libraryById = useSyncExternalStore(libraryRows.subscribe, libraryRows.get);
  const state = useSyncExternalStore(session.subscribe, session.get);
  const reduceMotion = useReducedMotion();
  const busyLabels = useSyncExternalStore(labels.subscribe, labels.get);
  const labelSlot = (slot: number, label: string | undefined) =>
    labels.update((previous) => {
      const next = new Map(previous);
      if (label === undefined) next.delete(slot);
      else next.set(slot, label);
      return next;
    });
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
                // Asking afresh draws other seed songs, once "Loading…" has painted.
                void session.renew({ turn: "paint" });
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
