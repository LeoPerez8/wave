/**
 * A Magic Queue's YouTube Music candidates (docs/spec.md, Magic Queue): the
 * radio of the seed's artist (or its songs' most credited artists), kept to
 * the seed's genres by the shared genre affinity check, outside artists'
 * genres looked up on Deezer. Which artists, which songs and how a batch
 * splits are Core's (`magicRadioArtists`, `magicYtCandidates`,
 * `magicBatch`); this asks YouTube Music and keeps what it found for the
 * session. None offline, or with the YT Music switch off.
 */
import {
  genreProfile,
  identityKey,
  libraryFinder,
  libraryGenreProfiles,
  magicRadioArtists,
  magicYtCandidates,
  mixAffinity,
  mixProfileLookups,
  pickYtArtist,
  ytArtistLookup,
  type GenreProfile,
  type GenreProfileOf,
  type MagicSeed,
  type MagicYtCandidate,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { Storage } from "expo-sqlite/kv-store";

import { lookUpArtistProfiles, lookedUpProfileOf } from "@/home/artistGenres";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import type { NativeYtRadioSong } from "@/native/waveYtMusic";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";

export type MagicRadioCandidate = MagicYtCandidate<NativeYtRadioSong>;

/** What a session's radio grows from, saved so it goes on after Wave restarts. */
interface RadioSeed {
  readonly sessionId: string;
  /** The artists whose radios it reads (`magicRadioArtists`). */
  readonly artists: readonly string[];
  /** The seed songs' genre profile, as [family, share] pairs; null when none has a genre. */
  readonly profile: readonly (readonly [string, number])[] | null;
}

const KEY = "playback.magicQueueRadio";

const readRadioSeed = (): RadioSeed | null => {
  try {
    const stored = Storage.getItemSync(KEY);
    return stored === null ? null : (JSON.parse(stored) as RadioSeed);
  } catch {
    return null;
  }
};

let radioSeed: RadioSeed | null = readRadioSeed();

/**
 * Keeps what session [sessionId]'s radio grows from: [seed]'s artists, and
 * its songs' ([seedSongs]) genres, which the radio's songs are held to.
 */
export const keepMagicRadioSeed = (
  sessionId: string,
  seed: MagicSeed,
  seedSongs: readonly SongRow[],
): void => {
  const profile = genreProfile(seedSongs);
  radioSeed = {
    sessionId,
    artists: magicRadioArtists(
      seed,
      seedSongs.map((song) => song.artist),
    ),
    profile: profile === null ? null : [...profile],
  };
  try {
    Storage.setItemSync(KEY, JSON.stringify(radioSeed));
  } catch {
    // Saving is best effort: the radio goes on in memory.
  }
};

/** A radio read takes this long at most; past it, the batch comes from the Library. */
const RADIO_TIMEOUT = "15 seconds";

/**
 * The first page of [name]'s artist radio, and the next one when there is
 * one; none when YouTube Music doesn't have the artist or can't be reached.
 */
const artistRadio = (name: string) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const store = yield* LibraryStore;
    const saved = yield* store.ytArtist(identityKey(name)).pipe(Effect.orElseSucceed(() => null));
    const lookup = ytArtistLookup(name, saved);
    if (lookup === null) return [];
    const browseId =
      lookup.kind === "page"
        ? lookup.browseId
        : pickYtArtist(
            name,
            yield* withSearchTurn("discover", lookup.query, ytMusic.searchArtists(lookup.query)),
          );
    if (browseId === null) return [];
    const first = yield* ytMusic.radio({ browseId });
    if (first.continuation === null) return first.songs;
    const next = yield* ytMusic
      .radioMore(first.continuation)
      .pipe(Effect.orElseSucceed(() => ({ songs: [], continuation: null })));
    return [...first.songs, ...next.songs];
  }).pipe(Effect.orElseSucceed((): readonly NativeYtRadioSong[] => []));

/** The candidates found for a session, kept so each batch doesn't read the radio again. */
let found: {
  readonly sessionId: string;
  readonly candidates: readonly MagicRadioCandidate[];
} | null = null;

/**
 * Session [sessionId]'s YouTube Music candidates (`magicYtCandidates`):
 * read once per session, again while none could be read (offline, say).
 * None with the YT Music switch off. Never fails.
 */
export const magicRadioCandidates = (sessionId: string) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return [];
    if (found?.sessionId === sessionId) return found.candidates;
    const seed = radioSeed;
    if (seed?.sessionId !== sessionId || seed.artists.length === 0) return [];
    const radios = yield* Effect.all(seed.artists.map(artistRadio), { concurrency: "unbounded" });
    const radio = radios.flat();
    if (radio.length === 0) return [];
    const store = yield* LibraryStore;
    const songs = yield* store.listSongs;
    const artists = yield* store.listArtists;
    const ofLibrary = libraryGenreProfiles({ artists, songs });
    const profileOf: GenreProfileOf = (artist) => {
      const own = ofLibrary(artist);
      return own === undefined ? lookedUpProfileOf(artist) : own;
    };
    yield* lookUpArtistProfiles(mixProfileLookups(radio, profileOf));
    const profile: GenreProfile | null = seed.profile === null ? null : new Map(seed.profile);
    const find = libraryFinder(songs);
    const candidates = magicYtCandidates(radio, {
      affinity: mixAffinity(profile, profileOf),
      inLibrary: (song) => find(song) !== null,
    });
    found = { sessionId, candidates };
    return candidates;
  }).pipe(
    Effect.timeout(RADIO_TIMEOUT),
    Effect.orElseSucceed((): readonly MagicRadioCandidate[] => []),
  );
