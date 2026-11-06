import { useLocalisation } from "@/localisation/localisation";
import { discoverSongs, discoverTrackId, type QueueContext } from "@wave/core";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { playListedNow } from "@/playback/actions";
import type { PlaybackState } from "@/playback/Player";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  type ListedSong,
} from "@/songs/mixedSongs";
import { SongList } from "@/songs/SongList";
import { useLibraryFinder } from "@/ytmusic/libraryFinder";

import { DismissArea } from "./DismissArea";
import { useRelatedSongs } from "./relatedSongs";
import { TrackHeader } from "./TrackHeader";

const NO_SONGS: readonly NativeYtSong[] = [];

/** Where a related song plays from: Play Now keeps the queue's own context. */
const RELATED: QueueContext = { kind: "related", id: null };

const playNow = (song: ListedSong): void => void playListedNow(song);
const runSwipe = (song: ListedSong, shown: Parameters<typeof runMixedSongSwipe>[1]): void =>
  runMixedSongSwipe(song, shown);

/**
 * Now Playing's Related view, in place of the cover: the playing song's
 * header (a tap returns to the player), then the songs YouTube Music's
 * Related tab gives for it ([videoId]; null for a song without one, undefined
 * while it isn't known; [findAgain] is Try Again's search for a Library song
 * none was found for, `usePlayingVideoId`). A song the Library has lists and plays as the
 * Library's. A tap plays it now and keeps Up Next; rows swipe and long-press
 * as anywhere. Offline or on a failure it says "Couldn't load the related
 * songs" with Try Again. Each song's answer is kept for the session.
 */
export function RelatedView({
  item,
  videoId,
  findAgain,
  onShowPlayer,
}: {
  item: NonNullable<PlaybackState["item"]>;
  videoId: string | null | undefined;
  findAgain: () => void;
  onShowPlayer: () => void;
}) {
  const { strings } = useLocalisation();
  const { shown, retry } = useRelatedSongs(videoId, findAgain);
  const find = useLibraryFinder(shown.status === "loaded");
  const read = shown.status === "loaded" ? shown.answer.songs : NO_SONGS;
  const songs = useMemo((): readonly ListedSong[] => discoverSongs(read, find), [read, find]);
  const entry = useCallback((song: ListedSong) => mixedSongEntry(song), []);
  return (
    <View className="flex-1">
      <DismissArea>
        <TrackHeader item={item} onShowPlayer={onShowPlayer} />
        <Hairline />
      </DismissArea>
      {shown.status === "loading" ? (
        <TrackSkeletons />
      ) : shown.status === "failed" ? (
        <RecommendationsFailed
          message={strings.playbackText.couldntLoadTheRelatedSongs}
          onRetry={retry}
          style={{ paddingTop: CELL * 2 }}
        />
      ) : songs.length === 0 ? (
        // A song whose watch page has no Related tab: nothing to read again.
        <Text
          accessibilityLiveRegion="polite"
          className="font-sans text-subheadline text-secondary"
          style={{ paddingTop: CELL * 2 }}
        >
          {strings.playbackText.couldntLoadTheRelatedSongs}
        </Text>
      ) : (
        <SongList
          className="flex-1"
          data={songs}
          keyExtractor={discoverTrackId}
          song={entry}
          context={RELATED}
          onPlay={playNow}
          onMenu={openMixedSongActions}
          onSongSwipe={runSwipe}
          contentContainerStyle={{ paddingBottom: CELL * 2 }}
        />
      )}
    </View>
  );
}
