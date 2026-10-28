import { artistPhotoName } from "./artistPhoto.ts";
import { DISCOVER_MIX_LEVELS, type DiscoverMixLevel } from "./discoverMixLevels.ts";
import type { DiscoverRadioSong } from "./discoverMixes.ts";
import { type GenreProfile, type GenreProfileOf, type GenreTagged } from "./genreAffinity.ts";
import { commonStyle, songFamilies, songStyle } from "./genreMixes.ts";
import type { PlayEnd } from "./playEvents.ts";
import type { QueueState } from "./queue.ts";
import { isRecord } from "./storedJson.ts";
import { MAGIC_SKIP_MS } from "./tasteProfile.ts";
import { drawSeedSongs } from "./seedSongDraw.ts";
import { type RandomSource } from "./weightedPick.ts";
import type { MixedSong } from "./ytDiscover.ts";
import { parseTrackId, recordingMatches, ytTrackId, type YtSong } from "./ytMusic.ts";

/**
 * An artist as the Magic Queue tells them apart, the same for the Library's
 * songs and YouTube Music's: by name, as artist photos (and the YouTube
 * Music artist finder) compare names (`magicArtistKey`).
 */
export type MagicArtistKey = string & { readonly magicArtist: true };

/** [name]'s key as the Magic Queue tells artists apart. */
export const magicArtistKey = (name: string): MagicArtistKey =>
  artistPhotoName(name) as MagicArtistKey;

/** A song as the Magic Queue weighs it. */
export interface MagicSong {
  /** Its queue track id. */
  readonly trackId: string;
  /** Who it's credited to, primary first. */
  readonly artists: readonly MagicArtistKey[];
  /** Its genre family's key (`genreFamily`), or null without a genre known. */
  readonly genre: string | null;
  /**
   * Its style's key (`songStyle`), or null without one known: a Library song's
   * own tags; radio songs carry no style.
   */
  readonly style: string | null;
}

/** A Library song as `magicLibrarySongs` reads it. */
export interface MagicLibrarySong extends GenreTagged {
  readonly id: number;
  /** Every artist it credits, primary first. */
  readonly artistIds: readonly number[];
}

/**
 * The Library's songs as the Magic Queue weighs them, the Library's
 * [artists] naming each song's: by their artists' names and the family of
 * their genre tag (its first value's, when it has several).
 */
export const magicLibrarySongs = (
  artists: readonly { readonly id: number; readonly name: string }[],
): ((song: MagicLibrarySong) => MagicSong) => {
  const keys = new Map(artists.map((artist) => [artist.id, magicArtistKey(artist.name)]));
  return magicSongMapper(keys);
};

const magicSongMapper =
  (keys: ReadonlyMap<number, MagicArtistKey>) =>
  (song: MagicLibrarySong): MagicSong => ({
    trackId: String(song.id),
    artists: song.artistIds.flatMap((id) => keys.get(id) ?? []),
    genre: songFamilies(song)[0]?.key ?? null,
    style: songStyle(song),
  });

/** Builds the shared Library-to-MagicSong mapper without one unbounded artist pass. */
export function* magicLibraryMapperSteps(
  artists: readonly { readonly id: number; readonly name: string }[],
): Generator<void, (song: MagicLibrarySong) => MagicSong> {
  const keys = new Map<number, MagicArtistKey>();
  for (const artist of artists) {
    keys.set(artist.id, magicArtistKey(artist.name));
    yield;
  }
  return magicSongMapper(keys);
}

/** The family that has the largest share of [profile] (the first on a tie), or null. */
const dominantFamily = (profile: GenreProfile | null | undefined): string | null => {
  let dominant: string | null = null;
  let most = 0;
  for (const [family, share] of profile ?? []) {
    if (share <= most) continue;
    dominant = family;
    most = share;
  }
  return dominant;
};

/**
 * A YouTube Music song as the Magic Queue weighs it: by its artists' names,
 * and the dominant genre family of its first artist with a profile known
 * ([profileOf]: the Library's, else Deezer's); none when no artist's is.
 */
export const magicYtSong = (
  song: { readonly trackId: string; readonly artists: readonly string[] },
  profileOf: GenreProfileOf,
): MagicSong => {
  let genre: string | null = null;
  for (const artist of song.artists) {
    genre = dominantFamily(profileOf(artist));
    if (genre !== null) break;
  }
  return {
    trackId: song.trackId,
    artists: song.artists.map(magicArtistKey),
    genre,
    style: null,
  };
};

/** What a Magic Queue was started from. */
export interface MagicSeed {
  readonly kind: "track" | "album" | "artist" | "playlist";
  readonly id: string;
  /** Its name, as Up Next says it ("Magic Queue · from <title>"). */
  readonly title: string;
}

/** The song whose radio starts the session; kept so an unmatched Library seed can be searched after restart. */
export interface MagicSongRadioSeed {
  readonly id: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number | null;
  readonly videoId?: string;
  readonly kind?: "song" | "artist";
}

/** A song of an album or playlist seed, whose radio a batch may read (`magicBatchRadios`). */
export interface MagicSeedSong extends MagicSongRadioSeed {
  /** Its counted plays: the most played are drawn most often. */
  readonly plays: number;
}

/**
 * The seed songs of an album or a playlist ([songs]: its Library songs, with
 * their artists' names and video id, and its streamed ones), in order, each
 * with its counted plays from [plays] (by queue track id; a song missing from
 * it was never counted): a streamed song is a seed as a Library one is.
 */
export const magicListSeedSongs = (
  songs: readonly MixedSong<
    YtSong,
    Omit<MagicSongRadioSeed, "id" | "kind"> & { readonly id: number }
  >[],
  plays: ReadonlyMap<string, number>,
): MagicSeedSong[] =>
  songs.map((song) => {
    if (song.source === "library") {
      const { id, videoId, ...track } = song.track;
      return {
        id: `song:${id}`,
        ...track,
        ...(videoId === undefined ? {} : { videoId }),
        plays: plays.get(String(id)) ?? 0,
      };
    }
    const trackId = ytTrackId(song.song.videoId);
    return {
      id: `song:${trackId}`,
      title: song.song.title,
      artists: song.song.artists,
      durationMs: song.song.durationMs,
      videoId: song.song.videoId,
      plays: plays.get(trackId) ?? 0,
    };
  });

/** A Magic Queue under way: plain JSON saved with its queue. */
export interface MagicSession {
  readonly radioSeed?: MagicSongRadioSeed;
  /** Radios learned from favorites, downloads and hand-added songs, each once per recording. */
  readonly likedRadios?: readonly MagicSongRadioSeed[];
  /**
   * An album's or a playlist's songs (up to `MAX_SEED_SONGS`, the most
   * played), a few of whose radios each batch reads; none for a song or an
   * artist seed, or a session saved before.
   */
  readonly seedSongs?: readonly MagicSeedSong[];
  /** The ids of the seed songs drawn so far, each once, the least recently drawn first. */
  readonly seedDraws?: readonly string[];
  /** The seed songs whose radios batch [batch] reads, by id. */
  readonly seedRadios?: { readonly batch: number; readonly ids: readonly string[] };
  /** Signals consumed by the shared radio ranking. Old sessions have none. */
  readonly radioSignals?: readonly MagicSignal[];
  /** Tells this session apart from the others: its queue's context id. */
  readonly id: string;
  readonly seed: MagicSeed;
  /** Every song the session queued, each once: none comes back. */
  readonly used: readonly string[];
  /** How many batches followed the first song so far. */
  readonly batches: number;
  /**
   * The share of each batch YouTube Music's candidates get (the Library's is
   * the rest): its level's (`magicQueueShare`) at the start, always between 0.2 and 1.
   */
  readonly ytShare: number;
  /** The artists whose YouTube Music radios it draws on (`magicRadioArtists`); none without. */
  readonly radioArtists: readonly string[];
  /**
   * The seed songs' genre profile, by family key, which its YouTube Music
   * candidates are held to (`magicSeedProfile`); null when none has a genre.
   */
  readonly seedProfile: Readonly<Record<string, number>> | null;
  /**
   * The seed songs' style (`commonStyle` of theirs), retained for saved
   * session compatibility; eligibility comes from radios.
   */
  readonly seedStyle: string | null;
  /**
   * The seed songs' YouTube video ids (those downloaded from YouTube): whose
   * own radio a refill reads when its radio artists' bring nothing; none without.
   */
  readonly seedVideoIds: readonly string[];
}

/** What a Magic Queue's YouTube Music radio grows from, as `startMagicQueue` takes it. */
export interface MagicRadioSeed {
  readonly song?: MagicSongRadioSeed;
  /** An album's or a playlist's songs, whose radios its batches read in turn. */
  readonly songs?: readonly MagicSeedSong[];
  /** Each seed song's primary artist, by name, as YouTube Music is asked for them. */
  readonly artists: readonly string[];
  /** The seed songs' genre profile (`genreProfile`), or null when none has a genre. */
  readonly profile: GenreProfile | null;
  /** The seed songs' YouTube video ids, in the seed's order; none without. */
  readonly videoIds?: readonly string[];
}

/** [artists]' profiles together ([profileOf]), each known one counting alike; null when none is known. */
const averageProfile = (
  artists: Iterable<string>,
  profileOf: GenreProfileOf,
): GenreProfile | null => {
  const weights = new Map<string, number>();
  let known = 0;
  for (const artist of artists) {
    const profile = profileOf(artist);
    if (profile === null || profile === undefined || profile.size === 0) continue;
    known += 1;
    for (const [family, share] of profile) weights.set(family, (weights.get(family) ?? 0) + share);
  }
  if (known === 0) return null;
  return new Map([...weights].map(([family, weight]) => [family, weight / known]));
};

/**
 * The seed's known genre profile for ranking: saved tags first, then known
 * artist profiles.
 * Missing profiles remain neutral and never prevent a radio recording joining.
 */
export const magicSeedProfile = (
  session: MagicSession,
  profileOf?: GenreProfileOf,
): GenreProfile | null => {
  if (session.seedProfile !== null) return new Map(Object.entries(session.seedProfile));
  if (profileOf === undefined) return null;
  return averageProfile(session.radioArtists, profileOf);
};

/** The context kind of a Magic Queue's queue; its id is the session's. */
export const MAGIC_QUEUE_CONTEXT = "magic";

/** YouTube Music's share of a batch: where it starts without a level, and how far it can go either way. */
const YT_SHARE_START = 0.5;
const YT_SHARE_MIN = 0.2;
const YT_SHARE_MAX = 1;

const clampShare = (share: number): number => Math.min(YT_SHARE_MAX, Math.max(YT_SHARE_MIN, share));

/**
 * The YouTube Music share a Magic Queue starts at for Discover's new-music
 * [level], on the mixes' scale (`DISCOVER_MIX_LEVELS`): from 20% at level 1
 * to 100% at level 5 (All new), 60% at level 3 (the default). Signals then
 * move it within those bounds.
 */
export const magicQueueShare = (level: DiscoverMixLevel): number =>
  (level * YT_SHARE_MAX) / DISCOVER_MIX_LEVELS.length;

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed): it plays that song, or a random one of the
 * seed's otherwise. Its YouTube Music radio grows from [radio] (none
 * without). YouTube Music's share of a batch starts at [ytShare]
 * (`magicQueueShare`, kept within 20-100%), half without. Null when the seed
 * has no songs.
 */
export const startMagicQueue = (
  seed: MagicSeed,
  seedSongs: readonly MagicSong[],
  {
    id,
    random,
    radio,
    ytShare = YT_SHARE_START,
  }: {
    readonly id: string;
    readonly random: RandomSource;
    readonly radio?: MagicRadioSeed;
    readonly ytShare?: number;
  },
): { readonly session: MagicSession; readonly first: string } | null => {
  const pick =
    seed.kind === "track"
      ? (seedSongs.find((candidate) => candidate.trackId === seed.id) ?? seedSongs[0])
      : seedSongs[Math.floor(random() * seedSongs.length)];
  if (pick === undefined) return null;
  return {
    session: {
      id,
      seed,
      ...(radio?.song === undefined ? {} : { radioSeed: radio.song }),
      ...(radio?.songs === undefined || radio.songs.length === 0
        ? {}
        : { seedSongs: mostPlayed(radio.songs), seedDraws: [] }),
      used: [pick.trackId],
      batches: 0,
      ytShare: clampShare(ytShare),
      radioArtists: radio === undefined ? [] : magicRadioArtists(seed, radio.artists),
      seedProfile:
        radio === undefined || radio.profile === null ? null : Object.fromEntries(radio.profile),
      seedStyle: commonStyle(seedSongs.map((candidate) => candidate.style)),
      seedVideoIds: radio?.videoIds ?? [],
    },
    first: pick.trackId,
  };
};

/**
 * Starts a Magic Queue from a streamed YT Music [song] (Search, a YT Music
 * list, a Discover mix, the queue): it plays that song first, and its
 * batches read the song's own radio by its video, as a Library song's
 * session does. Its genre comes from its artists' known profiles
 * (`magicSeedProfile`), since a stream has no tags.
 */
export const startStreamedMagicQueue = (
  song: YtSong,
  { id, ytShare }: { readonly id: string; readonly ytShare?: number },
): { readonly session: MagicSession; readonly first: string } => {
  const trackId = ytTrackId(song.videoId);
  const started = startMagicQueue(
    { kind: "track", id: trackId, title: song.title },
    [{ trackId, artists: song.artists.map(magicArtistKey), genre: null, style: null }],
    {
      id,
      random: () => 0,
      radio: {
        song: {
          id: `song:${trackId}`,
          title: song.title,
          artists: song.artists,
          durationMs: song.durationMs,
          videoId: song.videoId,
        },
        artists: song.artists,
        profile: null,
        videoIds: [song.videoId],
      },
      ...(ytShare === undefined ? {} : { ytShare }),
    },
  );
  // A song seed always has its song.
  return started!;
};

/** How many of an album's or a playlist's songs a session keeps to draw its radios from. */
const MAX_SEED_SONGS = 200;

/** Up to `MAX_SEED_SONGS` of [songs], the most played, in their order. */
const mostPlayed = (songs: readonly MagicSeedSong[]): readonly MagicSeedSong[] => {
  if (songs.length <= MAX_SEED_SONGS) return songs;
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  const kept = new Set([...songs].sort((a, b) => b.plays - a.plays).slice(0, MAX_SEED_SONGS));
  return songs.filter((song) => kept.has(song));
};

/**
 * The radios [session]'s next batch reads: an album's or a playlist's draws
 * up to 3 of its songs by different artists, the most played most often,
 * leaving out songs drawn for earlier batches while others remain
 * (`drawSeedSongs`). The draw is made once a batch; [session] comes back
 * with it, to save, and the same while that batch's draw stands. A song or
 * an artist seed reads its own radio (`radioSeed`); none for an old session
 * without one.
 */
export const magicBatchRadios = (
  session: MagicSession,
  random: RandomSource,
): { readonly session: MagicSession; readonly seeds: readonly MagicSongRadioSeed[] } => {
  const songs = session.seedSongs;
  if (songs === undefined || songs.length === 0)
    return { session, seeds: session.radioSeed === undefined ? [] : [session.radioSeed] };
  const byId = new Map(songs.map((song) => [song.id, song]));
  if (session.seedRadios?.batch === session.batches)
    return { session, seeds: session.seedRadios.ids.flatMap((id) => byId.get(id) ?? []) };
  const drawn = drawSeedSongs(
    songs.map((song) => ({ id: song.id, artist: song.artists[0] ?? "", plays: song.plays })),
    { weight: "plays", recent: session.seedDraws ?? [], random },
  ).map((song) => song.id);
  const again = new Set(drawn);
  return {
    session: {
      ...session,
      seedDraws: [...(session.seedDraws ?? []).filter((id) => !again.has(id)), ...drawn],
      seedRadios: { batch: session.batches, ids: drawn },
    },
    seeds: drawn.flatMap((id) => byId.get(id) ?? []),
  };
};

/**
 * Something the owner did to a song of the session:
 * - `skip`: tapped Next within its first 30 s (`magicPlaySignal`).
 * - `removed`: took a recommendation out of Up Next; it counts as a skip.
 * - `favorite`, `download`, `playedThrough`: positive, strongest first.
 * - `added`: lined it up with Play Next or Add to Queue; positive.
 */
export type MagicSignalKind =
  "skip" | "removed" | "favorite" | "download" | "playedThrough" | "added";

export interface MagicSignal {
  readonly kind: MagicSignalKind;
  readonly song: MagicSong;
  /** Recording metadata for a favorite, download or hand addition's song radio. */
  readonly radio?: MagicSongRadioSeed;
}

/** How a YouTube Music song's signal moves YouTube Music's share of a batch; others leave it. */
const YT_SHARE_MOVE: { readonly [K in MagicSignalKind]?: number } = {
  favorite: 0.1,
  download: 0.05,
  skip: -0.1,
  removed: -0.1,
};

/** A downloaded Library track and its streamed recording share one radio. */
const sameRadio = (a: MagicSongRadioSeed, b: MagicSongRadioSeed): boolean =>
  a.id === b.id ||
  (a.kind !== "artist" &&
    b.kind !== "artist" &&
    ((a.videoId !== undefined && a.videoId === b.videoId) ||
      recordingMatches(
        { title: a.title, artist: a.artists.join(", "), durationMs: a.durationMs ?? 0 },
        b,
      )));

/**
 * Records a ranking signal and marks its song used. Positive actions can add
 * a radio; streamed favorites, downloads and skips adjust New music's share.
 * Legacy affinity and exclusion fields are ignored when old sessions load.
 */
export const magicSignal = (
  learning: MagicSession,
  { kind, song, radio }: MagicSignal,
): MagicSession => {
  const move = parseTrackId(song.trackId)?.kind === "yt" ? (YT_SHARE_MOVE[kind] ?? 0) : 0;
  const session = {
    ...learning,
    ...(radio !== undefined &&
    (kind === "favorite" || kind === "download" || kind === "added") &&
    ![
      ...(learning.likedRadios ?? []),
      ...(learning.radioSeed === undefined ? [] : [learning.radioSeed]),
    ].some((seed) => sameRadio(seed, radio))
      ? { likedRadios: [...(learning.likedRadios ?? []), radio] }
      : {}),
    radioSignals: [...(learning.radioSignals ?? []), { kind, song }],
    ytShare: move === 0 ? learning.ytShare : clampShare(learning.ytShare + move),
  };
  const used = session.used.includes(song.trackId) ? session.used : [...session.used, song.trackId];
  return { ...session, used };
};

/** Tapping Next before this much of a song played is a skip; later, it's neutral. */
export { MAGIC_SKIP_MS };

/**
 * What a play's end tells a Magic Queue: Next (moving on to the following
 * entry) within its first 30 s is a skip, played to the end is positive;
 * anything else (Next later, Previous, picking another Up Next entry, a
 * replay, stopped, cut short) says nothing (null).
 */
export const magicPlaySignal = ({
  play,
  byNext,
}: {
  readonly play: Pick<PlayEnd["play"], "endReason" | "listenedMs">;
  readonly byNext: PlayEnd["byNext"];
}): "skip" | "playedThrough" | null => {
  if (play.endReason === "completed") return "playedThrough";
  return play.endReason === "skipped" && byNext && play.listenedMs < MAGIC_SKIP_MS ? "skip" : null;
};

/**
 * Whether [state] is [session]'s queue: started by it (its context) and not
 * replaced since. Playing something else ends the session.
 */
export const isMagicQueue = (session: MagicSession, state: QueueState): boolean =>
  state.context?.kind === MAGIC_QUEUE_CONTEXT && state.context.id === session.id;

/** A recommendation: a context entry of a Magic Queue (songs lined up by hand have none). */
const recommended = (entry: QueueState["entries"][number]): boolean => entry.contextIndex !== null;

/**
 * Whether [session] should add its next batch to [state]: it's still the
 * session's queue and Up Next holds no recommendation, so the batch is
 * picked once the previous one was weighed. Songs lined up by hand don't
 * hold it back.
 */
export const wantsMagicBatch = (session: MagicSession, state: QueueState): boolean =>
  isMagicQueue(session, state) &&
  state.index >= 0 &&
  !state.entries.slice(state.index + 1).some(recommended);

/**
 * Whether Up Next shows [session]'s next batch loading (skeleton rows where
 * it will land): a batch is being picked for it ([picking] is the id of the
 * session one is picked for, null while none is) and [state] still wants it.
 * So the loading goes the moment the batch lands in Up Next, and the moment
 * something else plays, whenever the picking itself ends.
 */
export const magicBatchLoading = (
  session: MagicSession | null,
  picking: MagicSession["id"] | null,
  state: QueueState,
): boolean => session !== null && picking === session.id && wantsMagicBatch(session, state);

/**
 * Whether Up Next shows that [session]'s next batch couldn't be picked (a
 * quiet line with Try Again): its last pick failed ([failed] is the id of
 * the session whose pick failed, null while none has) and [state] still
 * wants the batch. So the line goes once a batch lands, and once something
 * else plays.
 */
export const magicBatchFailed = (
  session: MagicSession | null,
  failed: MagicSession["id"] | null,
  state: QueueState,
): boolean => session !== null && failed === session.id && wantsMagicBatch(session, state);

/**
 * Whether Up Next says that [session]'s last pick found no songs (a quiet
 * line with Try Again, #638): it came back empty ([empty] is the id of the
 * session whose pick did, null while none has) and [state] still wants the
 * batch. So the line goes once a batch lands, and once something else plays.
 */
export const magicBatchEmpty = (
  session: MagicSession | null,
  empty: MagicSession["id"] | null,
  state: QueueState,
): boolean => session !== null && empty === session.id && wantsMagicBatch(session, state);

/**
 * Whether [session] should pick its next batch now: it wants one
 * (`wantsMagicBatch`) and its last pick didn't come back empty ([empty]:
 * the id of the session whose did). After an empty pick, moving through the
 * queue doesn't pick again (the same inputs would find the same nothing);
 * Try Again, a new signal or a slider move clears the mark first.
 */
export const magicPickDue = (
  session: MagicSession,
  empty: MagicSession["id"] | null,
  state: QueueState,
): boolean => empty !== session.id && wantsMagicBatch(session, state);

/** What follows a batch's picking once it ends (`magicPickEnded`). */
export interface MagicPickEnd {
  /** The session a batch is picked for now: still the one that took over, if another did. */
  readonly picking: MagicSession["id"] | null;
  /** Whether to pick again, now for the session under way. */
  readonly again: boolean;
}

/**
 * What follows the picking of a batch for session [ran] once it ends,
 * however it ended, while a batch is picked for [picking] and [session] is
 * under way in [state]: it clears only its own picking, so an older
 * session's pick ending leaves a newer one loading; and when another
 * session took over meanwhile and wants its batch, that one is picked at
 * once rather than at the next queue change. The session it ran for never
 * picks again on its own (a failed or empty pick would go round): the next
 * queue change asks again, after an empty pick only once its mark is
 * cleared (`magicPickDue`).
 */
export const magicPickEnded = (
  ran: MagicSession["id"],
  picking: MagicSession["id"] | null,
  session: MagicSession | null,
  state: QueueState,
): MagicPickEnd => ({
  picking: picking === ran ? null : picking,
  again: session !== null && session.id !== ran && wantsMagicBatch(session, state),
});

/** What the owner did to a Magic Queue between two states of it, by track id. */
export interface MagicQueueEdits {
  /** Songs lined up by hand (Play Next, Add to Queue): positive. */
  readonly added: readonly string[];
  /** Recommendations taken out of Up Next: skips. */
  readonly removed: readonly string[];
}

const NO_EDITS: MagicQueueEdits = { added: [], removed: [] };

/**
 * The edits that took [session]'s queue from [before] to [after]: entries
 * lined up by hand that weren't there (a batch's entries are the session's
 * own), and recommendations in Up Next that are gone. None once either
 * isn't the session's queue (a new play replaced it).
 */
export const magicQueueEdits = (
  session: MagicSession,
  before: QueueState,
  after: QueueState,
): MagicQueueEdits => {
  if (before === after || !isMagicQueue(session, before) || !isMagicQueue(session, after))
    return NO_EDITS;
  const beforeKeys = new Set(before.entries.map((entry) => entry.key));
  const afterKeys = new Set(after.entries.map((entry) => entry.key));
  const added = after.entries
    .filter((entry) => !recommended(entry) && !beforeKeys.has(entry.key))
    .map((entry) => entry.trackId);
  const removed = before.entries
    .slice(before.index + 1)
    .filter((entry) => recommended(entry) && !afterKeys.has(entry.key))
    .map((entry) => entry.trackId);
  return added.length === 0 && removed.length === 0 ? NO_EDITS : { added, removed };
};

/** How many artists' radios a Magic Queue's YouTube Music candidates come from. */
const RADIO_ARTISTS = 2;

/**
 * The artists whose YouTube Music radio a Magic Queue started from [seed]
 * draws on: an artist seed's own; else the most credited of its songs'
 * artists ([seedArtists], one name per song), two at most, the most
 * credited first (the first credited on a tie).
 */
export const magicRadioArtists = (
  seed: MagicSeed,
  seedArtists: readonly string[],
): readonly string[] => {
  if (seed.kind === "artist") return [seed.title];
  const counts = new Map<string, number>();
  for (const artist of seedArtists) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  const ranked = [...counts.entries()];
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked.slice(0, RADIO_ARTISTS).map(([artist]) => artist);
};

/** A YouTube Music candidate of a Magic Queue: a song it weighs, with the radio's [song] it is. */
export type MagicYtCandidate<S extends DiscoverRadioSong> = MagicSong & { readonly song: S };

/** What Up Next says over a Magic Queue: "Magic Queue · from <seed>". */
export const magicQueueLabel = (session: MagicSession): string =>
  `Magic Queue · from ${session.seed.title}`;

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isWeights = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every((weight) => typeof weight === "number");

const SEED_KINDS: ReadonlySet<unknown> = new Set(["track", "album", "artist", "playlist"]);

/** Whether [value] is a saved `MagicSongRadioSeed`. */
const isRadioSeed = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["title"] === "string" &&
  isStrings(value["artists"]) &&
  (value["durationMs"] === null || typeof value["durationMs"] === "number") &&
  (value["videoId"] === undefined || typeof value["videoId"] === "string") &&
  (value["kind"] === undefined || value["kind"] === "song" || value["kind"] === "artist");

/**
 * Reads a saved session (`JSON.parse` of one), or null when it isn't a valid
 * one. A session saved before it kept its radio (or with an unreadable one)
 * reads back with none.
 */
export const parseMagicSession = (value: unknown): MagicSession | null => {
  if (!isRecord(value)) return null;
  const { id, seed, used, batches, ytShare, radioArtists, seedProfile, seedStyle, seedVideoIds } =
    value;
  if (typeof id !== "string" || !isRecord(seed)) return null;
  if (!SEED_KINDS.has(seed["kind"])) return null;
  if (typeof seed["id"] !== "string" || typeof seed["title"] !== "string") return null;
  if (!isStrings(used)) return null;
  if (typeof batches !== "number" || !Number.isInteger(batches) || batches < 0) return null;
  const radioSeed = value["radioSeed"];
  const likedRadios = value["likedRadios"];
  const radioSignals = value["radioSignals"];
  const validSeed = isRadioSeed(radioSeed);
  const seedSongs = value["seedSongs"];
  const seedDraws = value["seedDraws"];
  const seedRadios = value["seedRadios"];
  const validSeedSongs =
    Array.isArray(seedSongs) &&
    seedSongs.every((song) => isRadioSeed(song) && typeof song["plays"] === "number");
  const validSeedRadios =
    isRecord(seedRadios) &&
    typeof seedRadios["batch"] === "number" &&
    Number.isInteger(seedRadios["batch"]) &&
    isStrings(seedRadios["ids"]);
  const validSignals =
    Array.isArray(radioSignals) &&
    radioSignals.every(
      (signal) =>
        isRecord(signal) &&
        ["skip", "removed", "favorite", "download", "playedThrough", "added"].includes(
          String(signal["kind"]),
        ) &&
        isRecord(signal["song"]) &&
        typeof signal["song"]["trackId"] === "string" &&
        isStrings(signal["song"]["artists"]) &&
        (signal["song"]["genre"] === null || typeof signal["song"]["genre"] === "string") &&
        (signal["song"]["style"] === null || typeof signal["song"]["style"] === "string"),
    );
  return {
    ...(validSeed ? { radioSeed: radioSeed as unknown as MagicSongRadioSeed } : {}),
    ...(Array.isArray(likedRadios) && likedRadios.every(isRadioSeed)
      ? { likedRadios: likedRadios as unknown as readonly MagicSongRadioSeed[] }
      : {}),
    ...(validSignals ? { radioSignals: radioSignals as unknown as readonly MagicSignal[] } : {}),
    // A list session saved before its seed songs were kept reads its old radio, if any.
    ...(validSeedSongs
      ? {
          seedSongs: seedSongs as unknown as readonly MagicSeedSong[],
          seedDraws: isStrings(seedDraws) ? seedDraws : [],
          ...(validSeedRadios
            ? { seedRadios: seedRadios as unknown as NonNullable<MagicSession["seedRadios"]> }
            : {}),
        }
      : {}),
    id,
    seed: { kind: seed["kind"] as MagicSeed["kind"], id: seed["id"], title: seed["title"] },
    used,
    batches,
    // A session saved before YouTube Music joined starts its share afresh.
    ytShare:
      typeof ytShare === "number" && Number.isFinite(ytShare)
        ? clampShare(ytShare)
        : YT_SHARE_START,
    radioArtists: isStrings(radioArtists) ? radioArtists : [],
    seedProfile: isWeights(seedProfile) ? seedProfile : null,
    // Before styles were saved, family overlap and closeness are both required.
    seedStyle: typeof seedStyle === "string" ? seedStyle : null,
    // Before the seed's video ids were saved, a refill reads only its artists' radios.
    seedVideoIds: isStrings(seedVideoIds) ? seedVideoIds : [],
  };
};
