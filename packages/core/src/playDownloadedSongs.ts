/**
 * Play Downloaded Songs (docs/spec.md, Resume on reconnect): while a song
 * waits for the network, the button under Now Playing's controls plays
 * something on the phone so the music doesn't stop. It goes on to the next
 * queue entry with a file on the phone; with none ahead, it plays Library
 * songs seeded from the stalled song's artists, ranked as the Magic Queue's
 * Library stand-in ranks them, with no network.
 */
import { finishSteps } from "./buildSteps.ts";
import { isDisliked, NO_DISLIKES } from "./dislikes.ts";
import { magicArtistKey, type MagicSession, type MagicSong } from "./magicQueue.ts";
import { libraryStandInSteps, type MagicStandInOptions } from "./magicStandIn.ts";
import { lapEntries, queueHistory, upNext, type QueueEntry, type QueueState } from "./queue.ts";

/** How many Library songs Play Downloaded Songs plays next when nothing ahead is on the phone. */
export const DOWNLOADED_STAND_IN_SONGS = 10;

/** What Play Downloaded Songs knows of the phone, the stalled song and the session. */
export interface PlayDownloadedSongsOptions extends Omit<
  MagicStandInOptions,
  "picking" | "sleepTimer"
> {
  /**
   * The Track id the queue song [trackId] plays from on the phone: its own
   * for a Library song with its file, its Library copy's for a YT Music song
   * downloaded since it was queued; null when it isn't on the phone.
   */
  readonly onPhone: (trackId: string) => string | null;
  /** The stalled song's artists, by name: the stand-in's seeds. */
  readonly stalledArtists: readonly string[];
  /** The Magic Queue session under way, whose moods apply; none for another queue. */
  readonly session?: MagicSession | null;
}

/**
 * What Play Downloaded Songs plays: the queue entry to go on to (`next`, by
 * its key, as the Track id it plays from on the phone), or Library songs to
 * play next with the old queue's rest after them (`library`, by Track id).
 */
export type DownloadedSongsPick =
  | { readonly kind: "next"; readonly key: string; readonly trackId: string }
  | { readonly kind: "library"; readonly trackIds: readonly string[] };

/**
 * The next entry of [state] in play order whose song is on the phone: Up
 * Next's, in its order (shuffled when shuffle is on), then with Repeat All
 * the next lap's, from History's start. Null with none.
 */
const nextOnPhone = (
  state: QueueState,
  onPhone: (trackId: string) => string | null,
): { readonly entry: QueueEntry; readonly trackId: string } | null => {
  const first = (entries: readonly QueueEntry[]) => {
    for (const entry of entries) {
      const trackId = onPhone(entry.trackId);
      if (trackId !== null) return { entry, trackId };
    }
    return null;
  };
  const ahead = first(upNext(state));
  if (ahead !== null || state.repeat !== "all") return ahead;
  const lap = new Set(lapEntries(state));
  return first(queueHistory(state).filter((entry) => lap.has(entry)));
};

/**
 * Whether the song playing over [state] can be held up by the network: one
 * plays, and not from its own file on the phone. Just after a tap jumped to
 * a song on the phone, the signal can still show for a moment; the button
 * then hides, and a second tap does nothing.
 */
const heldUpByNetwork = (
  state: QueueState,
  onPhone: (trackId: string) => string | null,
): boolean => {
  const current = state.entries[state.index];
  return current !== undefined && onPhone(current.trackId) !== current.trackId;
};

/**
 * Whether Play Downloaded Songs shows over [state]: a song that can be held
 * up plays, and an entry ahead is on the phone or [library] (its playable
 * songs) has a song that isn't disliked. Cheaper than the pick
 * (`playDownloadedSongs`), and it agrees with it: the stand-in plays every
 * song that isn't disliked, a mood's "off" ones and other artists' last.
 */
export const playDownloadedSongsShows = (
  state: QueueState,
  library: readonly MagicSong[],
  { onPhone, disliked = NO_DISLIKES }: PlayDownloadedSongsOptions,
): boolean =>
  heldUpByNetwork(state, onPhone) &&
  (nextOnPhone(state, onPhone) !== null ||
    library.some((song) => !isDisliked(disliked, { id: song.trackId })));

/**
 * What Play Downloaded Songs plays over [state], [library] being the
 * Library's playable songs (with a file, and not passed over); null when
 * nothing on the phone can play, and the button doesn't show.
 */
export const playDownloadedSongs = (
  state: QueueState,
  library: readonly MagicSong[],
  options: PlayDownloadedSongsOptions,
): DownloadedSongsPick | null => finishSteps(playDownloadedSongsSteps(state, library, options));

/** `playDownloadedSongs`, a step per Library song, for a background slice (#1448). */
export function* playDownloadedSongsSteps(
  state: QueueState,
  library: readonly MagicSong[],
  options: PlayDownloadedSongsOptions,
): Generator<void, DownloadedSongsPick | null> {
  if (!heldUpByNetwork(state, options.onPhone)) return null;
  const next = nextOnPhone(state, options.onPhone);
  if (next !== null) return { kind: "next", key: next.entry.key, trackId: next.trackId };
  // The stalled song's artists lead, then their neighbours by their hops in
  // the artist graph, each hop ranked apart; moods, dislikes and the songs
  // already queued count as they do for any stand-in.
  const seeds = new Set(options.stalledArtists.map(magicArtistKey));
  const trackIds = yield* libraryStandInSteps(
    {
      artists: options.stalledArtists,
      inSelection: (song) => song.artists.some((artist) => seeds.has(artist)),
      reach: 0,
      session: options.session ?? null,
      state,
      count: DOWNLOADED_STAND_IN_SONGS,
    },
    library,
    options,
  );
  return trackIds.length === 0 ? null : { kind: "library", trackIds };
}
