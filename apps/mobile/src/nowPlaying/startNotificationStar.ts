import { currentEntry, parseTrackId } from "@wave/core";

import { loadStars, scopedSongStarredNow, subscribeSongStars } from "@/library/favorites";
import { onDownloadedRecording, onLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { handleNotificationStarTap, notificationStarred } from "@/playback/notificationStarState";
import { queueState } from "@/playback/Queue";
import { queuedYtSong, queueTracks } from "@/playback/queueTracks";

import { createNotificationStar } from "./notificationStar";
import { nowPlayingSongActions, songActionFailed } from "./playingSong";
import { createNowPlayingSongLookup, playingSongTarget } from "./songLookup";

const NOT_STARRED = { favorite: false, pendingFavorite: false };

/**
 * Keeps the media notification's Favorite button on the playing song's star, and makes its
 * taps (and Android Auto's) toggle it as Now Playing's star does
 * (`createNotificationStar`). Call it once per JS runtime (`startServices` does).
 */
export const startNotificationStar = (): void => {
  const lookup = createNowPlayingSongLookup({
    read: (target, signal) => {
      signal.throwIfAborted();
      return appRuntime.runPromise(
        // oxlint-disable-next-line react/rules-of-hooks -- Effect service access.
        LibraryStore.use((store) => store.nowPlayingSong(target)),
        { signal },
      );
    },
  });
  onLibraryChange(lookup.change);
  onDownloadedRecording(lookup.downloaded);

  const star = createNotificationStar({
    lookup,
    starred: (target, answer) => {
      const ref = parseTrackId(target.trackId);
      return scopedSongStarredNow(
        ref?.kind === "library" ? ref.id : (answer?.track?.id ?? null),
        target.song?.videoId ?? null,
        answer ?? NOT_STARRED,
      );
    },
    show: notificationStarred.set,
    star: (target) => nowPlayingSongActions.star(target).catch(songActionFailed),
  });

  const follow = (): void => {
    const trackId = currentEntry(queueState.get())?.trackId ?? null;
    const track = trackId === null ? undefined : queueTracks.get().get(trackId);
    star.follow(playingSongTarget(trackId, track === undefined ? null : queuedYtSong(track)));
  };
  queueState.subscribe(follow);
  queueTracks.subscribe(follow);
  lookup.subscribe(star.refresh);
  subscribeSongStars(star.refresh);
  handleNotificationStarTap(star.tap);
  loadStars();
  follow();
};
