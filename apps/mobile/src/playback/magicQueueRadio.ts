/**
 * A Magic Queue's YouTube Music candidates (docs/spec.md, Magic Queue): the
 * radio of the seed's artist (or its songs' most credited artists), kept to
 * the seed's genres by the shared genre affinity check, outside artists'
 * genres looked up on Deezer. Which artists, which songs and how a batch
 * splits are Core's (`magicRadioArtists`, kept in the session,
 * `magicYtCandidates`, `magicBatch`); this asks YouTube Music and keeps
 * what it found for the session. None offline, or with the YT Music switch
 * off.
 */
import {
  libraryFinder,
  magicSeedProfile,
  magicYtCandidates,
  magicRadioLookups,
  magicYtSong,
  type GenreProfileLibrary,
  type GenreProfileOf,
  type MagicSession,
  type MagicSong,
  type MagicYtCandidate,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { lookUpArtistProfiles, lookedUpProfileOf, mixProfileOf } from "@/home/artistGenres";
import { artistRadio } from "@/home/ytArtistPage";
import { withNetworkLog } from "@/lib/networkMeter";
import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtRadioSong } from "@/native/waveYtMusic";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { YtMusic } from "@/ytmusic/YtMusic";

type MagicRadioCandidate = MagicYtCandidate<NativeYtRadioSong>;

/** A radio read takes this long at most; past it, the batch comes from the Library. */
const RADIO_TIMEOUT = "15 seconds";

/**
 * The first page of [name]'s artist radio, and the next one when there is
 * one; none when YouTube Music doesn't have the artist or can't be reached.
 */
const artistRadioSongs = (name: string) =>
  Effect.gen(function* () {
    const first = yield* artistRadio({ name });
    if (first === null) return [];
    if (first.continuation === null) return first.songs;
    const ytMusic = yield* YtMusic;
    const next = yield* ytMusic
      .radioMore(first.continuation)
      .pipe(Effect.orElseSucceed(() => ({ songs: [], continuation: null })));
    return [...first.songs, ...next.songs];
  }).pipe(Effect.orElseSucceed((): readonly NativeYtRadioSong[] => []));

/** The radio read for a session, kept so each batch doesn't read it again. */
interface RadioRead {
  readonly sessionId: string;
  readonly radio: readonly NativeYtRadioSong[];
  /** The artists whose genres it asked for so far (`magicRadioLookups`). */
  readonly asked: string[];
  /** The candidates last found in it, and the genre profiles they were weighed by. */
  candidates: readonly MagicRadioCandidate[];
  profileOf: GenreProfileOf;
}

let found: RadioRead | null = null;

type MagicLibrary = GenreProfileLibrary & { readonly songs: readonly SongRow[] };

/**
 * How [session]'s radio [read] is weighed against [library] now: the
 * artists to look up next (Core's `magicRadioLookups`: those that decide
 * the next candidates, till there are enough; the artists further down wait
 * for a later batch), and the candidates as the genres known now have them.
 */
const weighing = (session: MagicSession, library: MagicLibrary, read: RadioRead) => {
  const profileOf = mixProfileOf(library);
  const find = libraryFinder(library.songs);
  const inLibrary = (song: NativeYtRadioSong) => find(song) !== null;
  return {
    next: () => magicRadioLookups(session, read.radio, { profileOf, inLibrary, asked: read.asked }),
    candidates: () => {
      read.candidates = magicYtCandidates(read.radio, {
        seedProfile: magicSeedProfile(session),
        profileOf,
        inLibrary,
      });
      read.profileOf = profileOf;
      return read.candidates;
    },
  };
};

/** Looks up what [weigh] asks for, a round at a time, till it asks nothing more. */
const lookUpNeeded = (read: RadioRead, weigh: ReturnType<typeof weighing>) =>
  Effect.gen(function* () {
    for (let names = weigh.next(); names.length > 0; names = weigh.next()) {
      read.asked.push(...names);
      yield* lookUpArtistProfiles(names);
    }
    return weigh.candidates();
  });

/** [session]'s candidates, out of the radios of its `radioArtists` read now. */
const readRadioCandidates = (session: MagicSession, library: MagicLibrary) =>
  Effect.gen(function* () {
    const radios = yield* Effect.all(session.radioArtists.map(artistRadioSongs), {
      concurrency: "unbounded",
    });
    const radio = radios.flat();
    if (radio.length === 0) return [];
    // Kept before the genres are looked up, so a batch that runs out of time
    // leaves the radio to the next one.
    const read: RadioRead = {
      sessionId: session.id,
      radio,
      asked: [],
      candidates: [],
      profileOf: mixProfileOf(library),
    };
    found = read;
    return yield* lookUpNeeded(read, weighing(session, library, read));
  });

const candidatesOutcome = (candidates: readonly MagicRadioCandidate[]): string =>
  candidates.length === 1 ? "1 candidate" : `${candidates.length} candidates`;

/** [run], measured for the app log as [what] and cut short after a while. */
const loggedRead = <E, R>(what: string, run: Effect.Effect<readonly MagicRadioCandidate[], E, R>) =>
  withNetworkLog(what, run.pipe(Effect.timeout(RADIO_TIMEOUT)), candidatesOutcome);

/**
 * [session]'s YouTube Music candidates (`magicYtCandidates`), out of the
 * radios of its `radioArtists`, weighed against [library] (its songs and
 * artists): read once per session, again while none could be read
 * (offline, say), each read writing its network use to the app log
 * (`withNetworkLog`). Only the genres of the next candidates are looked up
 * (`magicRadioLookups`), so a later batch may look up more, writing its
 * own line. None with the YT Music switch off. Never fails.
 */
export const magicRadioCandidates = (session: MagicSession, library: MagicLibrary) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return [];
    const read = found?.sessionId === session.id ? found : null;
    if (read === null) {
      if (session.radioArtists.length === 0) return [];
      return yield* loggedRead("Magic Queue radio", readRadioCandidates(session, library)).pipe(
        // Out of time: the candidates the genres looked up so far make, if the radio was read.
        Effect.orElseSucceed((): readonly MagicRadioCandidate[] =>
          found?.sessionId === session.id ? weighing(session, library, found).candidates() : [],
        ),
      );
    }
    const weigh = weighing(session, library, read);
    if (weigh.next().length === 0) return weigh.candidates();
    return yield* loggedRead("Magic Queue genres", lookUpNeeded(read, weigh)).pipe(
      // Out of time: the candidates the genres looked up so far make.
      Effect.orElseSucceed(weigh.candidates),
    );
  });

/**
 * A YT Music song of the queue as the Magic Queue weighs it (`magicYtSong`):
 * by its artists, and its genre as the session's radio read weighed it (an
 * outside artist's as Deezer gave it, when no radio was read yet).
 */
export const magicStreamedSong = (track: {
  readonly id: string;
  readonly artists: readonly string[];
}): MagicSong =>
  found?.candidates.find((candidate) => candidate.trackId === track.id) ??
  magicYtSong({ trackId: track.id, artists: track.artists }, found?.profileOf ?? lookedUpProfileOf);
