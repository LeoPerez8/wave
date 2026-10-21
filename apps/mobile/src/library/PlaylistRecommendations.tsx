import { playlistRecommendations, type PlaylistRecommendation } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { TrackRow } from "@/catalog/TrackRow";
import { TitledSection } from "@/catalog/TitledSection";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { artistGraphNow } from "@/home/artistGraphNow";
import { lookedUpProfileOf } from "@/home/artistGenres";
import { WaveNative } from "@/native/waveNative";
import { playTrackIds, playYtSongs } from "@/playback/actions";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { LibraryStore, type PlaylistEntryRow } from "./LibraryStore";
import { appRuntime } from "./runtime";

/** Recommendations belong after editable playlist entries, within the same scroll view. */
export function PlaylistRecommendations({
  playlistId,
  items,
}: {
  playlistId: number;
  items: readonly PlaylistEntryRow[];
}) {
  const enabled = useYtMusicEnabled();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    songs: readonly PlaylistRecommendation[];
    loading: boolean;
    error: boolean;
  }>({ songs: [], loading: true, error: false });
  // Playlist membership and Retry renew the store snapshot even when the id stays the same.
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- both are explicit renewal triggers
  useEffect(() => {
    let active = true;
    void appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          const input = yield* store.playlistRecommendationInput(playlistId);
          const graph = yield* artistGraphNow;
          return playlistRecommendations(input.playlist, {
            ...input,
            graph,
            now: Date.now(),
            profileOf: lookedUpProfileOf,
            online: WaveNative.online(),
            ytMusicEnabled: enabled,
          });
        }),
      )
      .then((songs) => {
        if (active) setState({ songs, loading: false, error: false });
      })
      .catch(() => {
        if (active) setState((previous) => ({ ...previous, loading: false, error: true }));
      });
    return () => {
      active = false;
    };
  }, [playlistId, items, enabled, retry]);
  const play = ({ track }: PlaylistRecommendation) => {
    const context = { kind: "playlist", id: String(playlistId) } as const;
    if (track.source === "library") void playTrackIds([Number(track.id)], new Set(), 0, context);
    else void playYtSongs([track], 0, context);
  };
  return (
    <TitledSection
      title="Recommended songs"
      status={state.loading ? "Loading…" : undefined}
      action={
        state.error
          ? { label: "Try again", onPress: () => setRetry((value) => value + 1) }
          : undefined
      }
    >
      {state.loading && state.songs.length === 0 ? (
        <View
          accessible
          accessibilityLabel="Loading recommended songs"
          accessibilityState={{ busy: true }}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <View key={i} style={{ height: 64, justifyContent: "center" }}>
              <SkeletonLine lineHeight={22} width="60%" />
              <SkeletonLine lineHeight={18} width="40%" />
            </View>
          ))}
        </View>
      ) : (
        state.songs.map((song) => (
          <TrackRow
            key={song.track.id}
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
        ))
      )}
      {state.error && (
        <Text
          accessibilityLiveRegion="polite"
          className="font-sans text-subheadline text-secondary"
        >
          Couldn’t load recommendations. Your playlist is still available.
        </Text>
      )}
      {!state.loading && !state.error && state.songs.length === 0 && (
        <Text className="font-sans text-subheadline text-secondary">
          {items.length === 0
            ? "Add songs to get recommendations for this playlist."
            : "No more matching songs right now."}
        </Text>
      )}
    </TitledSection>
  );
}
