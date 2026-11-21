import { useLocalisation } from "@/localisation/localisation";
import {
  heldTracks,
  inLibraryUnlessHeld,
  playlistAddVisit,
  playlistSongKey,
  settlePlaylistAddVisit,
  stepPlaylistAddVisit,
  ytSectionView,
  type PlaylistAddVisit,
  type PlaylistSong,
  type QueueContext,
} from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SongRow } from "@wave/client";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { CELL, grid } from "@/catalog/grid";
import { SearchField } from "@/search/SearchField";
import { songResults } from "@/search/rows";
import { useSearchIndex } from "@/search/searchIndex";
import { useYtMusicSongsSection } from "@/search/ytMusicSearch";
import { useHeldSongs, useSongsInPlace } from "@/ytmusic/songsInPlace";
import { usePlaylist } from "@/library/hooks";
import { parseId } from "@/library/routes";
import { addToPlaylist, undoAddToPlaylist } from "@/library/playlists";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { mixedSongEntry } from "@/songs/mixedSongs";
import { librarySongEntry } from "@/songs/songListSources";
import { SongList, type SongListSelection } from "@/songs/SongList";
import { useChromeInset } from "@/chrome/chrome";

type AddSong =
  | { readonly kind: "library"; readonly track: SongRow }
  | { readonly kind: "stream"; readonly song: NativeYtSong };

const NO_TRACKS: ReadonlySet<number> = new Set();
const NO_YT_SONGS: readonly NativeYtSong[] = [];
const CONTEXT: QueueContext = { kind: "search", id: null };
const SONG_CARD = { leading: { kind: "playDisc" }, kindLine: true } as const;
const keyOf = (song: AddSong): string =>
  song.kind === "library" ? `library:${song.track.id}` : `yt:${song.song.videoId}`;
const asPlaylistSong = (song: AddSong): PlaylistSong =>
  song.kind === "library"
    ? { source: "library", trackId: song.track.id }
    : { source: "stream", song: song.song };
const asListEntry = (song: AddSong) =>
  song.kind === "library"
    ? librarySongEntry(song.track, { leading: SONG_CARD.leading, kindLine: SONG_CARD.kindLine })
    : mixedSongEntry({ source: "stream", song: song.song }, SONG_CARD);
const ignore = (): void => undefined;

/** The focused, song-only search that adds songs to one playlist without playing them. */
export default function AddPlaylistSongsScreen() {
  const { strings } = useLocalisation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = parseId(id);
  const detail = usePlaylist(playlistId);
  const playlist = detail?.playlist;
  const insets = useSafeAreaInsets();
  const bottomInset = useChromeInset();
  const [text, setText] = useState("");
  const query = useDeferredValue(text);
  const library = useSearchIndex(query.trim() !== "");
  const index = library?.index ?? null;
  const find = library?.find ?? null;
  const holding = useHeldSongs(query);
  const downloads = useMemo(
    () => (find === null ? NO_TRACKS : heldTracks(holding.held, find, (song) => song.id)),
    [holding.held, find],
  );
  const results = useMemo(
    () =>
      index === null || query.trim() === ""
        ? null
        : index.search(query, {
            limit: 200,
            skip:
              downloads.size === 0
                ? undefined
                : (hit) => hit.kind === "song" && downloads.has(hit.song.id),
          }),
    [index, query, downloads],
  );
  const ytSection = useYtMusicSongsSection(query);
  const inLibrary = library?.library;
  const ytView = useMemo(
    () =>
      inLibrary === undefined
        ? null
        : ytSectionView(ytSection, {
            ...inLibrary,
            hasSong: inLibraryUnlessHeld(holding.held, inLibrary.hasSong),
          }),
    [ytSection, inLibrary, holding.held],
  );
  const placed = useSongsInPlace(holding, ytView?.songs ?? NO_YT_SONGS, find);
  const songs = useMemo<readonly AddSong[]>(
    () => [
      ...(results === null
        ? []
        : songResults(results).map((track) => ({ kind: "library" as const, track }))),
      ...placed.songs.map((entry) =>
        entry.source === "library"
          ? ({ kind: "library" as const, track: entry.track } satisfies AddSong)
          : ({ kind: "stream" as const, song: entry.song } satisfies AddSong),
      ),
    ],
    [results, placed.songs],
  );

  const [visit, setVisit] = useState<PlaylistAddVisit | null>(null);
  // The visit every tap and settled write reads and updates, ahead of renders.
  const visitRef = useRef<PlaylistAddVisit | null>(null);
  const initialVisit = useMemo(() => {
    if (detail?.items === undefined) return null;
    return playlistAddVisit(
      detail.items.map((entry) => {
        if (entry.source === "library")
          return { source: "library", trackId: entry.track.id } as const;
        if (entry.source === "stream") return { source: "stream", song: entry.song } as const;
        if (entry.source === "unsearched")
          return { source: "unsearched", song: entry.song } as const;
        return { source: "unavailable", song: entry.song } as const;
      }),
    );
  }, [detail]);
  const shownVisit = visit ?? initialVisit;
  const updateVisit = useCallback((next: PlaylistAddVisit) => {
    visitRef.current = next;
    setVisit(next);
  }, []);

  const toggle = useCallback(
    async (song: AddSong) => {
      const current = visitRef.current ?? initialVisit;
      if (current === null) return;
      const playlistSong = asPlaylistSong(song);
      const step = stepPlaylistAddVisit(current, playlistSong);
      if (step.action === "none") return;
      updateVisit(step.visit);
      const settle = (outcome: "done" | "failed" | "held") => {
        const now = visitRef.current;
        if (now !== null) updateVisit(settlePlaylistAddVisit(now, playlistSong, outcome));
      };
      try {
        if (step.action === "add") {
          const answer = await addToPlaylist(playlistId, [playlistSong]);
          if (answer.added > 0) {
            settle("done");
            void showToast(strings.playlists.addedToPlaylist(playlist?.name ?? ""));
          } else settle("held");
        } else {
          await undoAddToPlaylist(playlistId, playlistSong);
          settle("done");
        }
      } catch (error) {
        settle("failed");
        void showError(strings.playlists.couldntAdd, error);
      }
    },
    [initialVisit, playlistId, playlist, strings, updateVisit],
  );

  const selection = useMemo<SongListSelection<AddSong>>(
    () => ({
      selecting: true,
      isChecked: (song) => {
        const current = shownVisit;
        if (current === null) return false;
        const key = playlistSongKey(asPlaylistSong(song));
        return current.alreadyIn.has(key) || current.added.has(key);
      },
      toggle: (song) => void toggle(song),
      start: (song) => void toggle(song),
    }),
    [shownVisit, toggle],
  );
  const renderSong = useCallback((song: AddSong) => asListEntry(song), []);
  return (
    <View className="flex-1 bg-background">
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: grid.margin, gap: CELL }}>
        <Text
          accessibilityRole="header"
          className="font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {playlist?.name ?? strings.playlists.addSongs}
        </Text>
        <SearchField
          value={text}
          onChange={setText}
          autoFocus
          placeholder={strings.playbackText.searchSongs}
          accessibilityLabel={strings.playbackText.searchSongs}
        />
      </View>
      {query.trim() === "" ? (
        <View className="flex-1" />
      ) : (
        <SongList
          className="flex-1"
          data={songs}
          keyExtractor={(song) => keyOf(song)}
          song={renderSong}
          context={CONTEXT}
          selection={selection}
          onPlay={(song) => void toggle(song)}
          onMenu={ignore}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
          extraData={shownVisit}
        />
      )}
    </View>
  );
}
