/**
 * The Play on New from Artists You Follow's header: the section's releases in its order, each
 * one's songs in album order, the Library's songs playing their files. The first release read
 * replaces the queue ("New queue playing", with Undo); the others join its end, in order, as
 * they're read, and one that couldn't be read is left out (Core's `followPlaySources`,
 * `followPlayStep`).
 */
import {
  FOLLOW_PLAY_CONTEXT,
  followPlaySources,
  followPlayStep,
  ytAlbumSongs,
  type FollowPlaySource,
  type FollowRelease,
  type MixedSong,
  type YtSong,
} from "@wave/core";
import { songHasFile, type SongRow } from "@wave/client";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { appendDiscoverSongs, playDiscoverSongs } from "@/playback/actions";
import { queueState } from "@/playback/Queue";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusicError } from "@/ytmusic/YtMusic";

type Listed = MixedSong<YtSong, SongRow>;

/** [source]'s songs in album order, or null when they couldn't be read. */
const songsOf = async (source: FollowPlaySource, title: string): Promise<Listed[] | null> => {
  if (source.kind === "library") {
    const album = await appRuntime
      .runPromise(Effect.flatMap(LibraryStore, (store) => store.getAlbum(source.albumId)))
      .catch(() => null);
    return album === null
      ? null
      : album.tracks.map((track): Listed => ({ source: "library", track }));
  }
  const result = await askYtMusic((yt) =>
    withSearchTurn(
      "search",
      title,
      Effect.gen(function* () {
        if (!followedArtistsEnabled() || !ytMusicEnabled())
          return yield* Effect.fail(new YtMusicError({ reason: "disabled" }));
        return yield* yt.album(source.browseId);
      }),
    ),
  ).catch(() => null);
  return result === null || Result.isFailure(result)
    ? null
    : ytAlbumSongs(source.browseId, result.success).map((song): Listed => ({
        source: "stream",
        song,
      }));
};

/** How many of [songs] can play: the YT Music ones, and the Library's with a file. */
const playableCount = (songs: readonly Listed[] | null): number | null =>
  songs === null ? null : songs.filter((s) => s.source === "stream" || songHasFile(s.track)).length;

let plays = 0;

/** Plays [cards] (the section's, newest first); resolves false when none of them could play. */
export const playNewReleases = async (cards: readonly FollowRelease[]): Promise<boolean> => {
  plays += 1;
  const id = `${Date.now()}-${plays}`;
  const context = { kind: FOLLOW_PLAY_CONTEXT, id };
  const sources = followPlaySources(cards, {
    ytMusic: followedArtistsEnabled() && ytMusicEnabled(),
  });
  let started = false;
  for (const source of sources) {
    const title = cards.find((r) => r.key === source.key)?.title ?? "";
    const songs = await songsOf(source, title);
    const step = followPlayStep(
      { started, context: queueState.get().context, id },
      playableCount(songs),
    );
    if (step === "stop") break;
    if (step === "skip" || songs === null) continue;
    if (step === "play") {
      await playDiscoverSongs(songs, undefined, context, { shuffle: false });
      started = true;
    } else await appendDiscoverSongs(songs);
  }
  return started;
};
