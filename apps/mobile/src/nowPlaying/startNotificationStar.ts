import { currentEntry, parseTrackId } from "@wave/core";

import {
  knownStarNow,
  loadStars,
  scopedSongStarredNow,
  subscribeSongStars,
} from "@/library/favorites";
import { handleNotificationStarTap, notificationStarred } from "@/playback/notificationStarState";
import { queueState } from "@/playback/Queue";
import { queuedYtSong, queueTracks } from "@/playback/queueTracks";

import { createNotificationStar } from "./notificationStar";
import { createPlayingSongLookup, nowPlayingSongActions, songActionFailed } from "./playingSong";
import { playingSongTarget } from "./songLookup";

/**
 * Keeps the media notification's Favorite button on the playing song's star, and makes its
 * taps (and Android Auto's) toggle it as Now Playing's star does
 * (`createNotificationStar`). Call it once per JS runtime (`startServices` does).
 */
export const startNotificationStar = (): void => {
  const lookup = createPlayingSongLookup();
  const star = createNotificationStar({
    lookup,
    starred: (target, answer) => {
      const ref = parseTrackId(target.trackId);
      if (ref?.kind === "library") return knownStarNow(ref.id);
      // A YT Music song's star needs its answer; an unsearched entry has none to take.
      if (ref?.kind !== "yt" || answer === undefined) return null;
      return scopedSongStarredNow(answer.track?.id ?? null, ref.videoId, answer);
    },
    show: notificationStarred.set,
    star: (target) => nowPlayingSongActions.star(target).catch(songActionFailed),
  });

  const follow = (): void => {
    // A read that failed is tried again as the song changes.
    loadStars();
    const trackId = currentEntry(queueState.get())?.trackId ?? null;
    const track = trackId === null ? undefined : queueTracks.get().get(trackId);
    star.follow(playingSongTarget(trackId, track === undefined ? null : queuedYtSong(track)));
  };
  queueState.subscribe(follow);
  queueTracks.subscribe(follow);
  lookup.subscribe(star.refresh);
  subscribeSongStars(star.refresh);
  handleNotificationStarTap(star.tap);
  follow();
};
