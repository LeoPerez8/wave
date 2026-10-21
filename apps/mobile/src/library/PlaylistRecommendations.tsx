import { IconPlus, IconX } from "@tabler/icons-react-native";
import { playlistRecommendationSession, type PlaylistRecommendationSlot } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { TitledSection } from "@/catalog/TitledSection";
import { TrackRow } from "@/catalog/TrackRow";
import { artistGraphNow } from "@/home/artistGraphNow";
import { lookedUpProfileOf } from "@/home/artistGenres";
import { Press } from "@/motion/Press";
import { makeExternalStore } from "@/lib/externalStore";
import { WaveNative } from "@/native/waveNative";
import { playTrackIds, playYtSongs } from "@/playback/actions";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { useThemeColor } from "@/theme/useThemeColor";

import { LibraryStore, type PlaylistEntryRow } from "./LibraryStore";
import { appRuntime } from "./runtime";
import { playlistsChanged } from "./playlists";

let nextOffer = 0;

/** One controller per playlist visit; offer keys protect against stale/repeated actions. */
export function PlaylistRecommendations({
  playlistId,
  items,
}: {
  playlistId: number;
  items: readonly PlaylistEntryRow[];
}) {
  const enabled = useYtMusicEnabled();
  const [enabledNow] = useState(() => makeExternalStore(enabled));
  const secondary = useThemeColor("secondary");
  const [session] = useState(() =>
    playlistRecommendationSession({
      newId: () =>
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextOffer}`,
      read: () =>
        appRuntime.runPromise(
          Effect.gen(function* () {
            const store = yield* LibraryStore;
            const input = yield* store.playlistRecommendationInput(playlistId);
            const graph = yield* artistGraphNow;
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
          }),
        ),
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
            if (added) playlistsChanged([playlistId]);
            return added;
          }),
    }),
  );
  const state = useSyncExternalStore(session.subscribe, session.get);
  // Membership and YT Music availability renew inputs, retaining unaffected slots.
  useEffect(() => {
    enabledNow.set(enabled);
    void session.renew();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- items is an explicit renewal trigger
  }, [session, items, enabled, enabledNow]);
  const play = ({ track }: PlaylistRecommendationSlot) => {
    const context = { kind: "playlist", id: String(playlistId) } as const;
    if (track.source === "library") void playTrackIds([Number(track.id)], new Set(), 0, context);
    else void playYtSongs([track], 0, context);
  };
  const songs = state.slots.filter((song) => song !== null);
  const busy = state.pending !== null || state.loading;
  return (
    <TitledSection
      title="Recommended songs"
      status={state.loading ? "Loading…" : undefined}
      action={
        state.error !== null && state.error !== "save"
          ? {
              label: "Try again",
              onPress: () => {
                void session.renew();
              },
            }
          : undefined
      }
    >
      {state.loading && songs.length === 0 ? (
        <View
          accessible
          accessibilityLabel="Loading recommended songs"
          accessibilityState={{ busy: true }}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <View key={i} style={{ height: grid.row, justifyContent: "center" }}>
              <SkeletonLine lineHeight={22} width="60%" />
              <SkeletonLine lineHeight={18} width="40%" />
            </View>
          ))}
        </View>
      ) : (
        songs.map((song) => (
          <View key={song.key} className="flex-row items-center">
            <View className="flex-1">
              <TrackRow
                leading="artwork"
                favorite={song.track.favorite}
                downloaded={song.track.downloaded}
                onPress={() => play(song)}
                track={{
                  id: song.track.id,
                  title: song.track.title,
                  artist: song.track.artists.join(" & "),
                  durationMs: song.track.durationMs,
                  artworkUri: song.track.artworkUrl ?? undefined,
                  explicit: song.track.explicit,
                }}
              />
            </View>
            <Press
              accessibilityRole="button"
              accessibilityLabel={`Add ${song.track.title} to playlist`}
              accessibilityState={{ disabled: busy, busy: state.pending === song.key }}
              disabled={busy}
              onPress={() => {
                void session.accept(song.key);
              }}
              className="items-center justify-center"
              style={{ width: 48, minHeight: 48, opacity: busy ? 0.45 : 1 }}
            >
              <IconPlus size={20} color={secondary} />
            </Press>
            <Press
              accessibilityRole="button"
              accessibilityLabel={`Dismiss ${song.track.title} recommendation`}
              accessibilityState={{ disabled: busy, busy: state.pending === song.key }}
              disabled={busy}
              onPress={() => {
                void session.dismiss(song.key);
              }}
              className="items-center justify-center"
              style={{ width: 48, minHeight: 48, opacity: busy ? 0.45 : 1 }}
            >
              <IconX size={20} color={secondary} />
            </Press>
          </View>
        ))
      )}
      {state.error !== null && (
        <Text
          accessibilityLiveRegion="polite"
          className="font-sans text-subheadline text-secondary"
        >
          {state.error === "save"
            ? "Couldn’t save your choice. Try the song’s action again."
            : state.error === "refill"
              ? "Your choice was saved. Couldn’t load a replacement. Try again."
              : "Couldn’t load recommendations. Try again."}
        </Text>
      )}
      {!state.loading && !state.error && songs.length === 0 && (
        <Text className="font-sans text-subheadline text-secondary">
          {items.length === 0
            ? "Add songs to get recommendations for this playlist."
            : "No more matching songs right now."}
        </Text>
      )}
    </TitledSection>
  );
}
