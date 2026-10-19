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
  magicYtSong,
  mixProfileLookups,
  type GenreProfileLibrary,
  type GenreProfileOf,
  type MagicSession,
  type MagicSong,
  type MagicYtCandidate,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { lookUpArtistProfiles, lookedUpProfileOf, mixProfileOf } from "@/home/artistGenres";
import { ytArtistBrowseId } from "@/home/ytArtistPage";
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
const artistRadio = (name: string) =>
  Effect.gen(function* () {
    const browseId = yield* ytArtistBrowseId(name);
    if (browseId === null) return [];
    const ytMusic = yield* YtMusic;
    const first = yield* ytMusic.radio({ browseId });
    if (first.continuation === null) return first.songs;
    const next = yield* ytMusic
      .radioMore(first.continuation)
      .pipe(Effect.orElseSucceed(() => ({ songs: [], continuation: null })));
    return [...first.songs, ...next.songs];
  }).pipe(Effect.orElseSucceed((): readonly NativeYtRadioSong[] => []));

/**
 * The candidates found for a session, kept so each batch doesn't read the
 * radio again, with the genre profiles they were weighed by.
 */
let found: {
  readonly sessionId: string;
  readonly candidates: readonly MagicRadioCandidate[];
  readonly profileOf: GenreProfileOf;
} | null = null;

/** [session]'s candidates, out of the radios of its `radioArtists` read now. */
const readRadioCandidates = (
  session: MagicSession,
  library: GenreProfileLibrary & { readonly songs: readonly SongRow[] },
) =>
  Effect.gen(function* () {
    const radios = yield* Effect.all(session.radioArtists.map(artistRadio), {
      concurrency: "unbounded",
    });
    const radio = radios.flat();
    if (radio.length === 0) return [];
    const profileOf = mixProfileOf(library);
    yield* lookUpArtistProfiles(mixProfileLookups(radio, profileOf));
    const find = libraryFinder(library.songs);
    const candidates = magicYtCandidates(radio, {
      seedProfile: magicSeedProfile(session),
      profileOf,
      inLibrary: (song) => find(song) !== null,
    });
    found = { sessionId: session.id, candidates, profileOf };
    return candidates;
  });

const candidatesOutcome = (candidates: readonly MagicRadioCandidate[]): string =>
  candidates.length === 1 ? "1 candidate" : `${candidates.length} candidates`;

/**
 * [session]'s YouTube Music candidates (`magicYtCandidates`), out of the
 * radios of its `radioArtists`, weighed against [library] (its songs and
 * artists): read once per session, again while none could be read
 * (offline, say), each read writing its network use to the app log
 * (`withNetworkLog`). None with the YT Music switch off. Never fails.
 */
export const magicRadioCandidates = (
  session: MagicSession,
  library: GenreProfileLibrary & { readonly songs: readonly SongRow[] },
) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return [];
    if (found?.sessionId === session.id) return found.candidates;
    if (session.radioArtists.length === 0) return [];
    return yield* withNetworkLog(
      "Magic Queue radio",
      readRadioCandidates(session, library).pipe(Effect.timeout(RADIO_TIMEOUT)),
      candidatesOutcome,
    ).pipe(Effect.orElseSucceed((): readonly MagicRadioCandidate[] => []));
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
