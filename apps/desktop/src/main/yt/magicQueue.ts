/**
 * The Magic Queue on the desktop (docs/spec.md, story 29a): a queue that goes on by itself from
 * a seed's YouTube Music radio and the Library, picked by Core's rules as the phone picks it.
 * A batch of recommendations joins when the last one starts; an ordinary queue at its last song
 * goes on as a Magic Queue of the list it came from (Continue Queue). Offline, or when YouTube
 * Music fails, a batch with nothing to add says so and Try Again picks again.
 *
 * What the phone also weighs (the taste profile, the artist graph, the chart, genre lookups,
 * Discover's sliders) isn't on the desktop yet: its ranking uses the seed's radio, the Library
 * and the session's own signals.
 */
import {
  DEFAULT_DISCOVER_MIX_LEVEL,
  MAGIC_QUEUE_CONTEXT,
  availableMagicSongs,
  completeMagicRadioBatch,
  continueMagicQueue,
  genreProfile,
  isMagicQueue,
  libraryFinder,
  magicBatchRadios,
  magicLibrarySongs,
  magicListSeedSongs,
  magicPickDue,
  magicPickEnded,
  magicPlaySignal,
  magicQueueEdits,
  magicQueueShare,
  magicRadioExclusions,
  magicRadioReadPlan,
  magicSignal,
  magicYtSong,
  parseMagicSession,
  queueContinuation,
  rankRadioSongs,
  startMagicQueue,
  startStreamedMagicQueue,
  wantsMagicBatch,
  ytTrackId,
  type MagicSeed,
  type MagicSession,
  type MagicSong,
  type MagicSongRadioSeed,
  type PlayEvent,
  type QueueCommand,
  type QueueContinuationSeed,
  type QueueState,
  type QueueTimeAhead,
  type RankedRadioSong,
  type SleepTimer,
  type YtAlbumSong,
} from "@wave/core";

import type { MagicQueueStatus, MagicQueueView } from "../../shared/ytPages.ts";
import type { YtStatus } from "../../shared/yt.ts";
import type { YtPagesShape, YtRadioRead } from "./ytPages.ts";

/** A Library song with a file, as the Magic Queue weighs it. */
export interface MagicQueueSong {
  readonly id: number;
  readonly title: string;
  /** Its artist credit. */
  readonly artist: string;
  readonly artistIds: readonly number[];
  readonly durationMs: number;
  readonly genre: string | null;
  /** The YouTube video it was downloaded from, when it was. */
  readonly videoId?: string;
}

/** What a Magic Queue starts from: its seed, the seed's Library songs and its streamed ones. */
export interface MagicQueueInput {
  readonly seed: MagicSeed;
  readonly songs: readonly MagicQueueSong[];
  readonly streamed: readonly YtAlbumSong[];
  /** A faithful session (Same genres, Balanced popularity), as a song clicked in Search starts. */
  readonly faithful?: boolean;
}

export interface MagicQueueDeps {
  readonly queue: () => QueueState;
  readonly dispatch: (command: QueueCommand) => Promise<void>;
  /** The Library's songs with a file, and its artists. */
  readonly library: () => {
    readonly songs: readonly MagicQueueSong[];
    readonly artists: readonly { readonly id: number; readonly name: string }[];
  };
  readonly pages: Pick<
    YtPagesShape,
    "songRadio" | "artistRadio" | "radioMore" | "findSong" | "findArtist"
  >;
  /** YT Music's setting. */
  readonly ytMusic: () => boolean;
  readonly online: () => boolean;
  /** Settings › Playback › Continue Queue. */
  readonly continueQueue: () => boolean;
  /** Whether the queue's current song is playing: an ordinary queue goes on only then. */
  readonly playing: () => boolean;
  /**
   * The running sleep timer. End of Queue lets the queue play out: no batch joins and no queue
   * goes on while it is set (Core's `wantsMagicBatch` and `queueContinuation`).
   */
  readonly sleepTimer: () => SleepTimer | null;
  /** How much of the queue is left against the Buffer; null to continue at the last song. */
  readonly ahead: () => QueueTimeAhead | null;
  /** The list a queue that ends came from (`queueContinuation`), or null when it's gone. */
  readonly continuation: (seed: QueueContinuationSeed) => MagicQueueInput | null;
  /** The saved session, across launches. */
  readonly load: () => string | null;
  readonly save: (json: string) => void;
  readonly random?: () => number;
  readonly now?: () => number;
}

export type { MagicQueueStatus, MagicQueueView };

export interface MagicQueueShape {
  /** Plays a Magic Queue of [input], replacing the queue; false when it has no song to play. */
  readonly start: (input: MagicQueueInput) => Promise<boolean>;
  /** Plays a Magic Queue of a YouTube Music song's radio, replacing the queue. */
  readonly startStreamed: (song: YtAlbumSong) => Promise<void>;
  /** The queue changed: the owner's edits teach the session, and a batch may be due. */
  readonly queueChanged: () => void;
  /** A play ended: a quick skip or a song played through teaches the session. */
  readonly playEnded: (
    play: Pick<PlayEvent, "trackId" | "endReason" | "listenedMs">,
    byNext: boolean,
  ) => void;
  readonly view: () => MagicQueueView;
  /** Try Again, after a batch found nothing. */
  readonly retry: () => void;
  /** Resolves once no batch is being picked. */
  readonly settled: () => Promise<void>;
}

/** How many of a seed's video ids a session keeps (the phone's `SEED_VIDEO_IDS`). */
const SEED_VIDEO_IDS = 50;

/** One radio as read so far this session: its songs and where it goes on. */
interface RadioRead {
  readonly songs: readonly YtAlbumSong[];
  readonly continuation: string | null;
}

/**
 * [seed]'s radio's first page: by its video, else its recording found by a search, else its
 * artist. Playlist suggestions read their seeds' radios this way too.
 */
export const radioFirstPage = async (
  pages: Pick<YtPagesShape, "songRadio" | "artistRadio" | "findSong" | "findArtist">,
  seed: MagicSongRadioSeed,
): Promise<YtRadioRead> => {
  const byArtist = async (name: string | undefined): Promise<YtRadioRead> => {
    if (name === undefined) return { status: "ok", songs: [], continuation: null };
    const artist = await pages.findArtist(name);
    return artist.browseId === null
      ? { status: artist.status, songs: [], continuation: null }
      : pages.artistRadio(artist.browseId);
  };
  const search = (): Promise<string | null> =>
    pages.findSong({
      title: seed.title,
      artists: seed.artists,
      durationMs: seed.durationMs,
    });
  /** A read whose only song is the seed (or none) is no radio: nothing similar to play. */
  const filled = (read: YtRadioRead): boolean => read.songs.length > 1;
  if (seed.kind === "artist") return byArtist(seed.artists[0] ?? seed.title);
  // The seed's own video is the best radio, but an official music video (OMV) id often has
  // no song radio on YouTube Music: its RDAMVM… queue comes back with just the seed. When
  // the video's radio is empty, fall back to the catalogue recording a search finds, then to
  // the artist, so a magic queue still fills from an OMV seed.
  const direct = seed.videoId === undefined ? null : await pages.songRadio(seed.videoId);
  if (direct !== null && (direct.status !== "ok" || filled(direct))) return direct;
  const found = await search();
  if (found !== null && found !== seed.videoId) {
    const viaSearch = await pages.songRadio(found);
    if (viaSearch.status !== "ok" || filled(viaSearch)) return viaSearch;
  }
  const artist = await byArtist(seed.artists[0]);
  if (artist.status !== "ok" || filled(artist)) return artist;
  return direct ?? artist;
};

export const createMagicQueue = (deps: MagicQueueDeps): MagicQueueShape => {
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  let session: MagicSession | null = (() => {
    const saved = deps.load();
    if (saved === null) return null;
    try {
      return parseMagicSession(JSON.parse(saved));
    } catch {
      return null;
    }
  })();
  const save = (next: MagicSession) => {
    session = next;
    deps.save(JSON.stringify(next));
  };
  /** The session under way, while its queue plays. */
  const active = (): MagicSession | null =>
    session !== null && isMagicQueue(session, deps.queue()) ? session : null;
  let picking: string | null = null;
  /** Why the session's last pick added nothing, by its id. */
  let stuck: {
    readonly id: string;
    readonly status: Exclude<MagicQueueStatus, "idle" | "loading">;
  } | null = null;
  /** This session's radios, by seed id. */
  let radios = new Map<string, RadioRead>();
  let radiosOf: string | null = null;
  let running: Promise<void> = Promise.resolve();
  let seen = deps.queue();
  /** The queue a continuation was last asked for, so each is asked once. */
  let continuedFrom: QueueState | null = null;
  /** Streamed songs a batch brought, for the signals a play of them gives. */
  const found = new Map<string, MagicSong>();

  const firstPage = (seed: MagicSongRadioSeed) => radioFirstPage(deps.pages, seed);

  /**
   * Reads [seeds]' radios: each one's first page once a session, and its next page when the
   * ranking says it runs [low]. Gives the worst status a read had.
   */
  const read = async (
    id: string,
    seeds: readonly MagicSongRadioSeed[],
    low: (seed: MagicSongRadioSeed) => boolean,
  ): Promise<YtStatus> => {
    if (radiosOf !== id) {
      radios = new Map();
      radiosOf = id;
    }
    const statuses = await Promise.all(
      seeds.map(async (seed): Promise<YtStatus> => {
        const known = radios.get(seed.id);
        if (known !== undefined && (known.continuation === null || !low(seed))) return "ok";
        const page =
          known === undefined
            ? await firstPage(seed)
            : await deps.pages.radioMore(known.continuation!);
        if (page.status !== "ok") return page.status;
        radios.set(seed.id, {
          songs: [...(known?.songs ?? []), ...page.songs],
          continuation: page.continuation,
        });
        return "ok";
      }),
    );
    return (
      statuses.find((status) => status === "offline") ?? statuses.find((s) => s !== "ok") ?? "ok"
    );
  };

  /** [wanted]'s next batch, as the phone picks one; how it went. */
  const pick = async (
    wanted: MagicSession,
  ): Promise<"appended" | Exclude<MagicQueueStatus, "idle" | "loading">> => {
    const drawn = magicBatchRadios(wanted, random);
    if (drawn.session !== wanted) save(drawn.session);
    const current = () => (session?.id === wanted.id ? session : drawn.session);
    const seeds =
      drawn.seeds.length > 0
        ? drawn.seeds
        : [
            {
              id: `song:${wanted.seed.id}`,
              title: wanted.seed.title,
              artists: wanted.radioArtists,
              durationMs: null,
              ...(wanted.seedVideoIds[0] === undefined ? {} : { videoId: wanted.seedVideoIds[0] }),
            },
          ];
    const liked = (current().likedRadios ?? []).filter(
      (radio) => !seeds.some((seed) => seed.id === radio.id),
    );
    const artists = [...new Set(seeds.flatMap((seed) => seed.artists))];
    const library = deps.library();
    const mapLibrary = magicLibrarySongs(library.artists);
    const inLibrary = libraryFinder(library.songs);
    const connected = deps.ytMusic() && deps.online();
    const rank = (group: readonly MagicSongRadioSeed[], original: boolean): RankedRadioSong[] => {
      const live = current();
      const pages = group.flatMap((seed) => {
        const radio = radios.get(seed.id);
        return radio === undefined
          ? []
          : [{ id: seed.id, artists: seed.artists, songs: radio.songs }];
      });
      return availableMagicSongs(
        live,
        rankRadioSongs(
          {
            artists,
            profile: genreProfile(
              library.songs.filter((song) => live.used.includes(String(song.id))),
            ),
          },
          {
            pages,
            library: original ? library.songs.map(mapLibrary) : [],
            inLibrary: (song) => {
              const local = inLibrary(song);
              return local === null ? null : mapLibrary(local);
            },
            signals: live.radioSignals ?? [],
          },
          {
            ...(live.faithful ? { faithfulness: 1, popularity: 3, excludeIncompatible: true } : {}),
            exclude: magicRadioExclusions(
              live,
              pages.flatMap((page) => page.songs),
            ),
            libraryFallback: live.continuation === true && !connected,
          },
        ),
        { online: connected, ytMusic: deps.ytMusic(), cachedVideos: null },
      );
    };
    const plan = magicRadioReadPlan(
      current(),
      rank(seeds, true),
      rank(liked, false),
      liked.length > 0,
    );
    const original = new Set(seeds.map((seed) => seed.id));
    const status =
      deps.ytMusic() || current().continuation === true
        ? await read(wanted.id, [...seeds, ...liked], (seed) =>
            original.has(seed.id) ? plan.seedLow : plan.likedLow,
          )
        : "disabled";
    const live = session;
    if (live?.id !== wanted.id || !wantsMagicBatch(live, deps.queue(), deps.sleepTimer()))
      return "appended";
    const batch = completeMagicRadioBatch(live, rank(seeds, true), rank(liked, false));
    if (batch.trackIds.length === 0)
      return status === "offline" || !connected
        ? "offline"
        : status === "failed"
          ? "failed"
          : "empty";
    save(batch.session);
    for (const song of batch.songs) if (song.source === "stream") found.set(song.trackId, song);
    await deps.dispatch({ type: "append", trackIds: [...batch.trackIds] });
    return "appended";
  };

  /** Picks batches while the session under way wants one, one at a time. */
  const fill = () => {
    running = running.then(async () => {
      let again = true;
      while (again) {
        const wanted = active();
        if (
          wanted === null ||
          !magicPickDue(wanted, stuck?.id ?? null, deps.queue(), deps.sleepTimer())
        )
          return;
        picking = wanted.id;
        stuck = null;
        try {
          const outcome = await pick(wanted);
          if (outcome !== "appended") stuck = { id: wanted.id, status: outcome };
        } catch {
          stuck = { id: wanted.id, status: "failed" };
        }
        const ended = magicPickEnded(wanted.id, picking, active(), deps.queue(), deps.sleepTimer());
        picking = ended.picking;
        again = ended.again;
      }
    });
  };

  /** Plays [first] as the queue of [started]'s session, its batches to follow. */
  const begin = async (started: MagicSession, first: string) => {
    save(started);
    stuck = null;
    const state = deps.queue();
    const playing = state.entries[state.index]?.trackId;
    await deps.dispatch({
      type: "play",
      trackIds: [first],
      startIndex: 0,
      context: { kind: MAGIC_QUEUE_CONTEXT, id: started.id },
      shuffle: false,
      // The song playing is the seed: it keeps playing, and Up Next turns into the Magic Queue.
      ...(started.seed.kind === "track" && playing === first
        ? { keepCurrentAndReplaceUpNext: { trackId: first } }
        : {}),
    });
    seen = deps.queue();
    fill();
  };

  /** A session of [input]; with [from], one that continues that queue rather than replacing it. */
  const startOf = async (
    { seed, songs, streamed, faithful }: MagicQueueInput,
    from?: QueueState,
  ) => {
    const { artists } = deps.library();
    const names = new Map(artists.map((artist) => [artist.id, artist.name]));
    const credited = (song: MagicQueueSong) => song.artistIds.flatMap((id) => names.get(id) ?? []);
    const list = seed.kind === "album" || seed.kind === "playlist" || seed.kind === "list";
    const lead = songs[0];
    const candidates =
      from === undefined
        ? songs.map(magicLibrarySongs(artists))
        : [
            magicYtSong(
              { trackId: from.entries[from.index]?.trackId ?? seed.id, artists: [] },
              () => null,
            ),
          ];
    const started = startMagicQueue(seed, candidates, {
      id: String(now()),
      random,
      radio: {
        artists: [...songs.flatMap(credited), ...streamed.flatMap((song) => song.artists)],
        ...(list
          ? {
              songs: magicListSeedSongs(
                [
                  ...songs.map((song) => ({
                    source: "library" as const,
                    track: {
                      id: song.id,
                      title: song.title,
                      artists: credited(song),
                      durationMs: song.durationMs,
                      ...(song.videoId === undefined ? {} : { videoId: song.videoId }),
                    },
                  })),
                  ...streamed.map((song) => ({ source: "stream" as const, song })),
                ],
                new Map(),
              ),
            }
          : lead !== undefined
            ? {
                song: {
                  id: seed.kind === "artist" ? `artist:${seed.id}` : `song:${seed.id}`,
                  title: seed.kind === "track" ? seed.title : lead.title,
                  artists: seed.kind === "artist" ? [seed.title] : credited(lead),
                  durationMs: lead.durationMs,
                  ...(lead.videoId === undefined ? {} : { videoId: lead.videoId }),
                  ...(seed.kind === "artist" ? { kind: "artist" as const } : {}),
                },
              }
            : streamed[0] === undefined
              ? {}
              : {
                  song: {
                    id: `song:${seed.id}`,
                    title: seed.title,
                    artists: streamed[0].artists,
                    durationMs: streamed[0].durationMs,
                    videoId: streamed[0].videoId,
                  },
                }),
        profile: genreProfile(songs),
        videoIds: [
          ...songs.flatMap((song) => song.videoId ?? []),
          ...streamed.map((song) => song.videoId),
        ].slice(0, SEED_VIDEO_IDS),
      },
      ytShare: magicQueueShare(DEFAULT_DISCOVER_MIX_LEVEL),
      faithful: from !== undefined || faithful === true,
    });
    if (started === null) return false;
    if (from !== undefined) {
      // A skip, Repeat or a new Play while it was read: the queue it was for is gone.
      if (deps.queue() !== from) return false;
      const continued = continueMagicQueue(started.session, from);
      await deps.dispatch({ type: "continueMagicQueue", sessionId: continued.id, from });
      if (deps.queue().context?.id !== continued.id) return false;
      save(continued);
      stuck = null;
      seen = deps.queue();
      fill();
      return true;
    }
    await begin(started.session, started.first);
    return true;
  };

  /** An ordinary queue at its end goes on as a Magic Queue of the list it came from. */
  const followQueueEnd = (state: QueueState) => {
    if (continuedFrom === state || !deps.playing()) return;
    const seed = queueContinuation(state, {
      enabled: deps.continueQueue(),
      sleepTimer: deps.sleepTimer(),
      ahead: deps.ahead(),
    });
    if (seed === null) return;
    continuedFrom = state;
    const input = deps.continuation(seed);
    if (input === null) return;
    running = running
      .then(() => startOf(input, state).then(() => undefined))
      .catch(() => undefined);
  };

  /** The song [trackId] as the session's signals know it. */
  const magicSong = (trackId: string): MagicSong => {
    const known = found.get(trackId);
    if (known !== undefined) return known;
    const library = deps.library();
    const song = library.songs.find((candidate) => String(candidate.id) === trackId);
    return song === undefined
      ? magicYtSong({ trackId, artists: [] }, () => null)
      : magicLibrarySongs(library.artists)(song);
  };

  return {
    start: async (input) => {
      let ok = false;
      running = running.then(async () => {
        ok = await startOf(input);
      });
      await running;
      return ok;
    },
    startStreamed: async (song) => {
      running = running.then(() => {
        const { session: started, first } = startStreamedMagicQueue(song, {
          id: String(now()),
          ytShare: magicQueueShare(DEFAULT_DISCOVER_MIX_LEVEL),
        });
        return begin(started, first);
      });
      await running;
    },
    queueChanged: () => {
      const state = deps.queue();
      const before = seen;
      seen = state;
      const live = session;
      if (live !== null && before !== state) {
        const edits = magicQueueEdits(live, before, state);
        let taught = live;
        for (const trackId of edits.added)
          taught = magicSignal(taught, { kind: "added", song: magicSong(trackId) });
        for (const trackId of edits.removed)
          taught = magicSignal(taught, { kind: "removed", song: magicSong(trackId) });
        if (taught !== live) save(taught);
      }
      if (active() !== null) fill();
      else followQueueEnd(state);
    },
    playEnded: (play, byNext) => {
      const live = active();
      if (live === null) return;
      const kind = magicPlaySignal({
        play,
        byNext,
      });
      if (kind !== null) save(magicSignal(live, { kind, song: magicSong(play.trackId) }));
    },
    view: () => {
      const live = active();
      if (live === null) return { title: null, status: "idle" };
      const state = deps.queue();
      const wants = wantsMagicBatch(live, state, deps.sleepTimer());
      return {
        title: live.seed.title,
        status:
          wants && stuck?.id === live.id
            ? stuck.status
            : wants && picking === live.id
              ? "loading"
              : "idle",
      };
    },
    retry: () => {
      stuck = null;
      fill();
    },
    settled: async () => {
      let last: Promise<void> | undefined;
      while (last !== running) {
        last = running;
        await running.catch(() => undefined);
      }
    },
  };
};

/** [videoId]'s queue id, for the bridge. */
export const magicTrackId = ytTrackId;
