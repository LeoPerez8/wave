import type { GeniusLyricsHit, RecognizeResult } from "@wave/core";
import { Linking, Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL } from "@/catalog/grid";
import { libraryListQueries } from "@/library/hooks";
import type { SongRow } from "@/library/LibraryStore";
import { openAddToPlaylist } from "@/library/PlaylistSheets";
import { openAlbum } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { useLocalisation } from "@/localisation/localisation";
import { pressedMenuAllowed, pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { showError } from "@/overlay/alert";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices, type MenuChoice } from "@/overlay/MenuChoices";
import { followUp, openOverlay } from "@/overlay/overlay";
import { playNext, playSongs, playYtNext, playYtSongs } from "@/playback/actions";
import type { RecognitionLookup } from "@/recognize/resolveRecognition";
import { resolveRecognitionSave } from "@/recognize/resolveRecognitionSave";
import { useYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";
import { searchRecordingInTurn } from "@/ytmusic/askYtMusic";
import { useLoadedInLibrary } from "@/ytmusic/libraryFinder";
import { cancelYtDownload, downloadYtSong, useYtDownloadStatus } from "@/ytmusic/YtDownloads";

import { geniusHitMenu, resolveGeniusHit, type GeniusHitEffects } from "./geniusHitMenu";

type Result = RecognizeResult<SongRow, NativeYtSong>;

const SEARCH_CONTEXT = { kind: "search", id: null } as const;

/**
 * Where a Genius result's song is looked up, by its tap and its long press alike: the
 * Library's songs as read now, then one Songs search with YT Music on.
 */
export const geniusHitLookup: RecognitionLookup<SongRow, NativeYtSong> = {
  library: () => appRuntime.runPromise(libraryListQueries.songs.read),
  ytMusic: ytMusicEnabled,
  search: (asker, _query, signal, song) => searchRecordingInTurn(asker, song, signal, true),
};

/**
 * Opens a Genius result's long-press menu next to its row, once the song is
 * resolved as a tap resolves it (Recognize's resolver: the Library first, then one
 * Songs search with YT Music on), so the card opens with every entry it will have.
 */
export const openGeniusHitActions = (hit: GeniusLyricsHit): void => {
  const anchor = pressedRect();
  const allowed = pressedMenuAllowed();
  // The row stays highlighted meanwhile: the card opens inside the follow-up.
  void followUp(async () => {
    const result = await resolveGeniusHit(geniusHitLookup, hit, new AbortController().signal);
    if (!allowed()) return;
    openOverlay({
      label: hit.title,
      anchor,
      render: (close) => <GeniusHitActionsMenu hit={hit} result={result} close={close} />,
    });
  });
};

/** The menu card: the hit (unless its row is highlighted), then Core's entries for what it resolved to. */
function GeniusHitActionsMenu({
  hit,
  result,
  close,
}: {
  hit: GeniusLyricsHit;
  result: Result;
  close: () => void;
}) {
  const { strings } = useLocalisation();
  const ytMusic = useYtMusicEnabled();
  const streamed = result.kind === "stream";
  const status = useYtDownloadStatus(streamed ? result.song.videoId : "");
  const inLibrary = useLoadedInLibrary(streamed);
  const text = strings.playbackText;
  const effects: GeniusHitEffects<SongRow, NativeYtSong> = {
    play: (song) => {
      const playing =
        song.source === "library"
          ? playSongs([song.track], 0, SEARCH_CONTEXT)
          : playYtSongs([song.song], 0, SEARCH_CONTEXT);
      void playing.catch((error: unknown) => showError(text.couldntPlayTheSong, error));
    },
    playNext: (song) => {
      const queued = song.source === "library" ? playNext([song.track]) : playYtNext([song.song]);
      void queued.catch((error: unknown) => showError(text.couldntQueueTheSong, error));
    },
    addToPlaylist: (picked) =>
      openAddToPlaylist({
        title: picked.song.title,
        songs: async () => [await resolveRecognitionSave(picked)],
      }),
    goToAlbum: (track) => openAlbum(track.albumId),
    download: downloadYtSong,
    cancelDownload: (song) => cancelYtDownload(song.videoId),
    openUrl: (url) => void Linking.openURL(url).catch(() => undefined),
  };
  const entries = geniusHitMenu(
    hit,
    result,
    { ytMusic, status, inLibrary: streamed && inLibrary(result.song) },
    strings,
    effects,
  ).map((entry): MenuChoice => ({
    action: entry.action,
    label: entry.label,
    onPress: () => {
      close();
      entry.run();
    },
  }));
  return (
    <>
      <CardHeading>
        <Artwork uri={hit.artworkUrl ?? undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {hit.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {hit.artist}
          </Text>
        </View>
      </CardHeading>
      <MenuChoices cards={[]} entries={entries} />
    </>
  );
}
