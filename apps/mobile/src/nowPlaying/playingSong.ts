import { currentLocalisation } from "@/localisation/localisation";
import { parseTrackId, streamedAfterDelete } from "@wave/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { scopedSongStarredNow, rememberSongFavorite } from "@/library/favorites";
import { onDownloadedRecording, onLibraryChange } from "@/library/libraryChanges";
import { confirmDeleteSongs } from "@/library/deleteSongs";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { starSongs } from "@/library/starSongs";
import { showError } from "@/overlay/alert";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { streamPlayingInstead } from "@/playback/actions";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { downloadMissingSongs, downloadYtSong } from "@/ytmusic/YtDownloads";
import { createNowPlayingSongLookup, type PlayingSongTarget } from "./songLookup";
import { createNowPlayingSongActions } from "./songActions";

export const nowPlayingSongLookup = createNowPlayingSongLookup({
  read: (target, signal) => {
    signal.throwIfAborted();
    return appRuntime.runPromise(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect service access.
      LibraryStore.use((store) => store.nowPlayingSong(target)),
      { signal },
    );
  },
});
onLibraryChange(nowPlayingSongLookup.change);
onDownloadedRecording(nowPlayingSongLookup.downloaded);

/** The YouTube video [track] was downloaded from, if any (none when it can't be read). */
const videoIdOf = (track: SongRow): Promise<string | null> =>
  appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect service access.
    .runPromise(LibraryStore.use((store) => store.videoIds([track.id])))
    .then(
      (ids) => ids.get(track.id) ?? null,
      () => null,
    );

/**
 * Download on a song with a file: the song menu's Delete, its confirmation
 * first. Playing from the file, the song goes on streamed from where it was
 * when it came from YouTube Music and YouTube Music is on (Core's
 * `streamedAfterDelete`); otherwise the delete moves the queue on to the
 * next song, as the menu's Delete does.
 */
const deletePlayingSong = async (
  target: PlayingSongTarget,
  track: SongRow & { readonly path: string },
): Promise<void> => {
  // Read before asking, so the queue streams it before the delete takes the file's entries out.
  const videoId = await videoIdOf(track);
  await confirmDeleteSongs([track], {
    onConfirm: () => {
      const song = streamedAfterDelete(target.trackId, track, {
        videoId,
        ytMusicOn: ytMusicEnabled(),
      });
      if (song !== null) void streamPlayingInstead(target.trackId, song);
    },
  });
};

export const nowPlayingSongActions = createNowPlayingSongActions(nowPlayingSongLookup, {
  download: (command, target) => {
    switch (command.kind) {
      case "delete":
        void deletePlayingSong(target, command.track).catch(songActionFailed);
        break;
      case "missing":
        downloadMissingSongs([command.id]);
        break;
      case "stream":
        downloadYtSong(command.song as NativeYtSong);
        break;
      case "gone":
        showError(
          currentLocalisation().strings.playbackText.couldntDownloadTheSong,
          currentLocalisation().strings.playbackText.theSongIsNoLongerInTheLibrary,
        );
        break;
    }
  },
  starred: (target, answer) =>
    scopedSongStarredNow(answer.track?.id ?? null, target.song?.videoId ?? null, answer),
  star: (target, answer, on) => {
    const track = answer.track;
    if (track !== null) rememberSongFavorite(track.id, answer.favorite);
    // The one-song answer is sufficient for starSongs; it never acquires a global finder.
    void starSongs(
      {
        tracks: track === null ? [] : [track],
        ytSongs: target.song === null ? [] : [target.song as NativeYtSong],
      },
      on,
      () => track,
      "nowPlaying",
    ).catch(songActionFailed);
  },
});
export const songActionFailed = (error: unknown): void => {
  void showError(currentLocalisation().strings.playbackText.couldntUpdateTheSong, error);
};

export const usePlayingSongTarget = (
  trackId: string | null,
  song: NativeYtSong | null,
): PlayingSongTarget | null =>
  useMemo(
    () =>
      trackId === null || (parseTrackId(trackId)?.kind === "yt" && song === null)
        ? null
        : { trackId, song },
    [trackId, song],
  );

/** One owner drives settlement; the controls only observe its shared answer. */
export const usePreparePlayingSong = (
  target: PlayingSongTarget | null,
  shown: boolean,
  settled: boolean,
): void => {
  useEffect(() => {
    nowPlayingSongLookup.update(target, shown, settled);
    return () => nowPlayingSongLookup.update(target, false, false);
  }, [target, shown, settled]);
};
export const usePlayingSongAnswer = (target: PlayingSongTarget | null) =>
  useSyncExternalStore(nowPlayingSongLookup.subscribe, () => nowPlayingSongLookup.get(target));
