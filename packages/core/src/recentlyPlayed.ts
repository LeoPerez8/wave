/**
 * Home's Recently played shelf: the albums of the songs played, the one
 * played last first. The store reads played songs by their latest play, a
 * page at a time, so the shelf costs a few songs however long the history.
 */

import type { PlayContext } from "./playEvents.ts";
import { compareRefIds } from "./refOrder.ts";

/** A played song, as the store reads it for the shelf. */
export interface LatestPlayedSong<Id = number> {
  readonly albumId: Id;
  /** When its latest play (counted or not) started. */
  readonly lastPlayedAt: number;
}

/**
 * The [limit] albums played most recently: an album's latest play is that of
 * its song played last; albums last played at the same time come by album id,
 * the highest (the latest added) first. [songs] are read latest played first;
 * [complete] says they are every played song. Null when they can't settle the
 * shelf yet: an album only counts once a song played after the last one read
 * names it, as a song not read yet may tie with that one. Read more and ask again.
 */
export const recentlyPlayedAlbums = <Id extends number | string>(
  songs: readonly LatestPlayedSong<Id>[],
  limit: number,
  complete: boolean,
): readonly Id[] | null => {
  const latest = new Map<Id, number>();
  for (const song of songs) {
    if (!latest.has(song.albumId)) latest.set(song.albumId, song.lastPlayedAt);
  }
  const lastRead = songs.at(-1)?.lastPlayedAt;
  const settled = [...latest].filter(
    ([, playedAt]) => complete || lastRead === undefined || playedAt > lastRead,
  );
  if (!complete && settled.length < limit) return null;
  return (
    settled
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort(([a, aAt], [b, bAt]) => bAt - aAt || compareRefIds(a, b, "latest first"))
      .slice(0, limit)
      .map(([albumId]) => albumId)
  );
};

/** What a Recently played card is: where the owner played from. */
export type RecentlyPlayedKind = "playlist" | "album" | "artist" | "song" | "mix";

/** A play as the store reads it for Recently played, the latest first. */
export interface RecentPlay {
  readonly context: PlayContext | null;
  readonly trackId: string;
  /** When the play started (ms). */
  readonly startedAt: number;
}

/** One Recently played card: a play context, at its latest play. */
export interface RecentlyPlayedContext {
  readonly kind: RecentlyPlayedKind;
  /**
   * What the card opens or plays: a playlist's, album's or artist's page
   * (`playlist`, `ytPlaylist`, `album`, `ytAlbum`, `artist`, `ytArtist`), a
   * mix's context as it played, or `song` with the song's track id.
   */
  readonly context: PlayContext;
  /** The song played last from it (a mix's cover, a streamed page's details). */
  readonly trackId: string;
  /** When its latest play started. */
  readonly playedAt: number;
}

/**
 * The play context of a song played on its own, by its track id: what
 * Recently played's song card plays, and what a session a plain play of a
 * song began records its plays under.
 */
export const SONG_PLAY_CONTEXT = "song";

/**
 * The mixes: Magic Queue, DJ, Discover's mixes, Related (Now Playing's
 * radio) and New from Artists You Follow's Play. They have no page, so their
 * card plays them again (`mixReplayContext`).
 */
const MIXES: ReadonlySet<string> = new Set([
  "magic",
  "dj",
  "discoverMix",
  "mix",
  "related",
  "newReleases",
]);

/** The play context of a mix played again from Recently played; its id names the mix. */
const MIX_REPLAY = "replay";

/**
 * What a mix's card plays its songs under: a context of its own, which
 * Recently played reads back as [mix], so the mix stays one card however
 * often it's played again, and no Magic Queue or DJ takes it for theirs.
 */
export const mixReplayContext = (mix: PlayContext): PlayContext => ({
  kind: MIX_REPLAY,
  id: `${mix.kind}:${mix.id ?? ""}`,
});

/** The mix a replay's [id] names (`mixReplayContext`). */
const replayedMix = (id: string): PlayContext => {
  const colon = id.indexOf(":");
  const kind = colon < 0 ? id : id.slice(0, colon);
  const mix = colon < 0 ? "" : id.slice(colon + 1);
  return { kind, id: mix === "" ? null : mix };
};

/** What `recordedPlayContext` reads of the Magic Queue session playing, if any. */
export interface RecordedSession {
  readonly id: string;
  readonly seed: { readonly kind: string; readonly id: string };
  readonly plainPlay?: boolean;
}

/**
 * The context a play from a queue of [context] is recorded under, [session]
 * the Magic Queue session saved: a session a plain play of a song began (a
 * Search tap) records its plays as that song's, and a DJ session as the DJ's,
 * so Recently played tells them from a Magic Queue. Any other queue keeps its
 * context.
 */
export const recordedPlayContext = (
  context: PlayContext | null,
  session: RecordedSession | null,
): PlayContext | null => {
  if (context?.kind !== "magic" || session === null || session.id !== context.id) return context;
  if (session.plainPlay === true) return { kind: SONG_PLAY_CONTEXT, id: session.seed.id };
  if (session.seed.kind === "dj") return { kind: "dj", id: session.id };
  return context;
};

/** A playlist, album or artist page's context kinds, each with what the card opens. */
const PAGES: Readonly<Record<string, { kind: RecentlyPlayedKind; context: string }>> = {
  playlist: { kind: "playlist", context: "playlist" },
  ytPlaylist: { kind: "playlist", context: "ytPlaylist" },
  album: { kind: "album", context: "album" },
  ytAlbum: { kind: "album", context: "ytAlbum" },
  artist: { kind: "artist", context: "artist" },
  // Shuffle All of an artist (Android Auto) is that artist's.
  artistSongs: { kind: "artist", context: "artist" },
  ytArtist: { kind: "artist", context: "ytArtist" },
};

/**
 * What Recently played shows for a play of [trackId] from [context]: its
 * playlist, album or artist (streamed ones included), the mix it played in,
 * or else the song itself (the Library's song list, Search, a single song's
 * Play, Play Next).
 */
export const recentlyPlayedContext = (
  context: PlayContext | null,
  trackId: string,
): Pick<RecentlyPlayedContext, "kind" | "context"> => {
  const page = context === null || context.id === null ? undefined : PAGES[context.kind];
  if (context?.kind === MIX_REPLAY && context.id !== null)
    return { kind: "mix", context: replayedMix(context.id) };
  if (context !== null && MIXES.has(context.kind)) return { kind: "mix", context };
  if (page !== undefined) return { kind: page.kind, context: { kind: page.context, id: context!.id } };
  // A plain play's session (a Search tap, a song's Play) is its song's, whatever plays after it.
  const song = context?.kind === SONG_PLAY_CONTEXT && context.id !== null ? context.id : trackId;
  return { kind: "song", context: { kind: SONG_PLAY_CONTEXT, id: song } };
};

/**
 * Recently played's [limit] cards, the latest played first: each play
 * context once, at its latest play (`recentlyPlayedContext`). [plays] are
 * read latest first (plays started at the same moment in a fixed order);
 * [complete] says they are every play. Null while they hold fewer than
 * [limit] contexts and more plays remain: read more and ask again.
 */
export const recentlyPlayedContexts = (
  plays: readonly RecentPlay[],
  limit: number,
  complete: boolean,
): readonly RecentlyPlayedContext[] | null => {
  const shown = new Map<string, RecentlyPlayedContext>();
  for (const play of plays) {
    if (shown.size >= limit) break;
    const { kind, context } = recentlyPlayedContext(play.context, play.trackId);
    const key = `${kind}\u0000${context.kind}\u0000${context.id ?? ""}`;
    if (!shown.has(key))
      shown.set(key, {
        kind,
        context,
        trackId: kind === "song" ? context.id! : play.trackId,
        playedAt: play.startedAt,
      });
  }
  if (shown.size < limit && !complete) return null;
  return [...shown.values()];
};
