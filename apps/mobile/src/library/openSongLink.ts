/**
 * Opening a song link shared to Wave (docs/spec.md, "Opening a song link"):
 * the song plays at once as a Magic Queue seeded by it, from the Library's
 * copy when there is one, else streamed, and Now Playing opens. Core decides
 * which copy plays (`songLinkLibraryCopy`, `songLinkPlay`) and what a link
 * that plays nothing says (`songLinkNotice`).
 */
import {
  linkedYtSong,
  songLinkLibraryCopy,
  songLinkNotice,
  songLinkPlay,
  type SongLink,
  type SongLinkFailure,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { currentLocalisation } from "@/localisation/localisation";
import { online } from "@/native/waveNative";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { showError, showMessage } from "@/overlay/alert";
import { currentToast, dismissToast, showToast } from "@/overlay/toast";
import { startMagicQueue, startStreamedMagicQueue } from "@/playback/MagicQueue";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { currentLibraryFinder } from "@/ytmusic/libraryFinder";

import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

const say = (failure: SongLinkFailure): void => {
  const notice = songLinkNotice(failure, currentLocalisation().language);
  void showMessage(notice.title, notice.message);
};

/** Takes the "Finding song…" toast away, unless another toast took its place. */
const endFinding = (id: number | undefined): void => {
  if (id !== undefined) dismissToast(id);
};

/**
 * Plays the song [link] names. Offline it says so and asks nothing. Else a
 * toast says "Finding song…" while YouTube Music is asked for the song's
 * radio, whose first song is the song itself (`linkedYtSong`); a video it
 * can't play says the link doesn't open. The Library's copy (the song
 * downloaded from that video, else `libraryFinder`'s) plays when it has one,
 * else the YT Music song streams, each as its Magic Queue (the previous
 * queue goes), and Now Playing opens. YT Music off was said before this.
 */
export const openSongLink = async (link: SongLink): Promise<void> => {
  const { strings } = currentLocalisation();
  if (!online()) {
    say("offline");
    return;
  }
  void showToast(strings.imports.findingSong);
  const finding = currentToast.get()?.id;
  const answer = await askYtMusic((ytMusic) => ytMusic.radio({ videoId: link.videoId })).catch(
    () => null,
  );
  if (answer === null || Result.isFailure(answer)) {
    endFinding(finding);
    say(answer === null ? "failed" : answer.failure.reason);
    return;
  }
  const song = linkedYtSong(link.videoId, answer.success.songs);
  if (song === null) {
    endFinding(finding);
    say("unplayable");
    return;
  }
  const [stored, find] = await Promise.all([
    appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* store.songWithVideo(link.videoId);
        }),
      )
      .catch(() => null),
    currentLibraryFinder().catch(() => null),
  ]);
  const copy = songLinkLibraryCopy(song, { stored, find: find ?? (() => null) });
  const play = songLinkPlay(song, copy, song);
  endFinding(finding);
  if (play.play === "notFound") {
    say({ notFound: play.song });
    return;
  }
  const start =
    play.from === "library"
      ? startMagicQueue(play.seed, [play.track])
      : startStreamedMagicQueue(play.song);
  try {
    await appRuntime.runPromise(start);
    openNowPlaying();
  } catch (error) {
    void showError(strings.playbackText.couldntStartTheMagicQueue, error);
  }
};
