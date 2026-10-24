import { parseTrackId } from "@wave/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { scopedSongStarredNow, rememberSongFavorite } from "@/library/favorites";
import { onDownloadedRecording, onLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { starSongs } from "@/library/starSongs";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import type { NativeYtSong } from "@/native/waveYtMusic";
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

export const nowPlayingSongActions = createNowPlayingSongActions(nowPlayingSongLookup, {
  download: (command) => {
    switch (command.kind) {
      case "downloaded":
        void showToast("Downloaded");
        break;
      case "missing":
        downloadMissingSongs([command.id]);
        break;
      case "stream":
        downloadYtSong(command.song as NativeYtSong);
        break;
      case "gone":
        showError("Couldn't download the song", "The song is no longer in the Library.");
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
  void showError("Couldn't update the song", error);
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
