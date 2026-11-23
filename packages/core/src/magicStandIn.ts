/**
 * The Magic Queue's Library stand-in (docs/spec.md, DJ and Magic Queue):
 * while a batch is late (no network, a slow one, a radio that couldn't be
 * read) and the queue's last song is playing, a few Library songs that pass
 * the session's mood and Artist variety join Up Next, with no network, so
 * the music doesn't stop. The batch joins after them once it lands.
 */
import type { ArtistGraph } from "./artistGraph.ts";
import { finishSteps, sortSteps } from "./buildSteps.ts";
import { isDisliked, NO_DISLIKES, type DislikedSongs } from "./dislikes.ts";
import { djMoodFit, type DjAudioFeatures, type DjMoodFit } from "./djMood.ts";
import { djArtistHops, REACH } from "./djVariety.ts";
import { wantsMagicBatch, type MagicSession, type MagicSong } from "./magicQueue.ts";
import type { QueueState } from "./queue.ts";
import type { SleepTimer } from "./sleepTimer.ts";
import { tasteWeight, type TasteProfile } from "./tasteProfile.ts";

/** How [magicStandIn] is asked: what it knows of the session's batch and of the Library. */
export interface MagicStandInOptions {
  /** Whether a pick of the session's batch is under way. */
  readonly picking: boolean;
  /** The sleep timer running, if any: End of Queue holds every batch back, stand-ins too. */
  readonly sleepTimer?: SleepTimer | null;
  /** Features found by Library files' ISRC tags, by Track id (`djMoodFit`). */
  readonly moodFeatures?: ReadonlyMap<string, DjAudioFeatures>;
  /** The disliked songs: none stands in. */
  readonly disliked?: DislikedSongs;
  /** The artist graph Artist variety reads, or null when it isn't built. */
  readonly graph?: ArtistGraph | null;
  /** What the owner likes, or null before it's read: among songs that rank alike, more liked first. */
  readonly taste?: TasteProfile | null;
}

/** Stand-in songs to append, and the session that holds them as queued. */
export interface MagicStandIn {
  readonly session: MagicSession;
  readonly trackIds: readonly string[];
}

/** A Library song that may stand in, and where it ranks. */
interface Candidate {
  readonly song: MagicSong;
  /** 0 known to fit the mood (or no mood), 1 of unknown mood. */
  readonly tier: number;
  /** Its artists' hops from the selected ones, within reach counted as reach. */
  readonly distance: number;
  /** `tasteWeight`, 1 with no taste profile. */
  readonly weight: number;
  /** Its place in the Library's order. */
  readonly at: number;
}

/** How many Library songs a stand-in appends at a time. */
export const MAGIC_STAND_IN_SONGS = 2;

/**
 * Whether [session]'s queue [state] wants Library songs to stand in for its
 * batch now: the queue's last song is playing with Repeat off, and its batch
 * hasn't landed though it's still wanted (`wantsMagicBatch`, so never under
 * an End of Queue [sleepTimer]). The first batch (none followed the first
 * song yet) gets its pick: a stand-in comes only once that pick ended
 * without songs, failed or found none. A later batch was asked for while a
 * few songs were left (`MAGIC_ASK_AHEAD`), so by the last song it's late,
 * even while its pick still runs ([picking]).
 */
export const magicStandInDue = (
  session: MagicSession,
  state: QueueState,
  { picking, sleepTimer = null }: Pick<MagicStandInOptions, "picking" | "sleepTimer">,
): boolean =>
  state.repeat === "off" &&
  state.index >= 0 &&
  state.index === state.entries.length - 1 &&
  (session.batches > 0 || !picking) &&
  wantsMagicBatch(session, state, sleepTimer);

/**
 * The Library songs of [library] (its playable songs) that stand in for
 * [session]'s late batch in [state], in order, and [session] holding them as
 * queued; null when none is due or none can play.
 */
export const magicStandIn = (
  session: MagicSession,
  state: QueueState,
  library: readonly MagicSong[],
  options: MagicStandInOptions,
): MagicStandIn | null => finishSteps(magicStandInSteps(session, state, library, options));

/** `magicStandIn`, a step per Library song, for a background slice (#1448). */
export function* magicStandInSteps(
  session: MagicSession,
  state: QueueState,
  library: readonly MagicSong[],
  options: MagicStandInOptions,
): Generator<void, MagicStandIn | null> {
  if (!magicStandInDue(session, state, options)) return null;
  const { moodFeatures = new Map(), disliked = NO_DISLIKES, graph = null, taste = null } = options;
  const mood = session.dj?.mood ?? null;
  // Artist variety: a song counts by its closest artist's hops from the
  // selected ones, every hop within reach alike (`djVarietyCandidates`). A
  // session that isn't a DJ one reaches only its seed artists, so they lead.
  const reach = session.dj === undefined ? 0 : REACH[session.dj.variety];
  const hopsOf = djArtistHops(session, graph);
  // Songs the session played or queued, and songs in Up Next or already
  // played from it (added by hand too), never stand in.
  const used = new Set(session.used);
  for (const entry of state.entries) used.add(entry.trackId);
  // Songs known to fit the mood come first; songs of unknown mood fill in
  // behind them, so a Library without features still keeps the session
  // playing. A song known to be off the mood never plays. Within each, songs
  // in reach come first, then the nearest: never a silence while the Library
  // has a song to play. The owner's taste orders songs that rank alike.
  const candidates: Candidate[] = [];
  for (const [at, song] of library.entries()) {
    yield;
    if (used.has(song.trackId) || isDisliked(disliked, { id: song.trackId })) continue;
    const fit: DjMoodFit =
      mood === null ? "matched" : djMoodFit(mood, moodFeatures.get(song.trackId) ?? null, null);
    if (fit === "off") continue;
    const tier = fit === "matched" ? 0 : 1;
    candidates.push({
      song,
      tier,
      distance: Math.max(reach, hopsOf(song.artists)),
      weight: taste === null ? 1 : tasteWeight(taste, song),
      at,
    });
  }
  const ranked = yield* sortSteps(
    candidates,
    (a, b) => a.tier - b.tier || a.distance - b.distance || b.weight - a.weight || a.at - b.at,
  );
  // High credits no artist twice, unless nothing else is left.
  const picked = new Set<Candidate>();
  const held = new Set<string>();
  for (const unique of session.dj?.variety === "high" ? [true, false] : [false])
    for (const candidate of ranked) {
      if (picked.size >= MAGIC_STAND_IN_SONGS) break;
      yield;
      if (picked.has(candidate)) continue;
      if (unique && candidate.song.artists.some((artist) => held.has(artist))) continue;
      picked.add(candidate);
      for (const artist of candidate.song.artists) held.add(artist);
    }
  const trackIds = ranked.filter((each) => picked.has(each)).map((each) => each.song.trackId);
  if (trackIds.length === 0) return null;
  return { session: { ...session, used: [...session.used, ...trackIds] }, trackIds };
}
