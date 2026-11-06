import { currentLocalisation } from "@/localisation/localisation";
import { parseTrackId } from "@wave/core";
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
import { createDeletePlayingSong } from "./deletePlayingSong";
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

/** Now Playing's Download on a song with a file (`createDeletePlayingSong`). */
const deletePlayingSong = createDeletePlayingSong<SongRow & { readonly path: string }>({
  leaving: (track) =>
    appRuntime
      // oxlint-disable-next-line react/rules-of-hooks -- Effect service access.
      .runPromise(LibraryStore.use((store) => store.leavingSong(track.id)))
      .catch(() => null),
  ytMusicOn: ytMusicEnabled,
  confirmDelete: confirmDeleteSongs,
  streamInstead: streamPlayingInstead,
});

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
