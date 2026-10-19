/**
 * Which radio artists' genres to look up on Deezer next (docs/spec.md,
 * genre affinity): only those that decide a song the mix (or the Magic
 * Queue) would keep next, in the radio's order, and none once enough songs
 * match. The app looks them up, then asks again, till nothing is left to ask.
 */

import { artistPhotoName } from "./artistPhoto.ts";
import {
  MIX_FEWEST,
  MIX_MOST,
  mixRecordingOf,
  type DiscoverMixFilter,
  type DiscoverRadioSong,
} from "./discoverMixes.ts";
import { mixAffinity, type GenreProfileOf } from "./genreAffinity.ts";
import { magicArtistKey, magicSeedProfile, type MagicSession } from "./magicQueue.ts";
import { ytTrackId } from "./ytMusic.ts";
import { ytArtistQuery } from "./ytArtist.ts";

/** What a walk over a radio's songs asks: the names to look up, and how many songs matched. */
interface Asking {
  readonly names: string[];
  readonly matched: number;
}

/**
 * The names [songs] (each a song the mix would keep, genre aside) ask for:
 * walking them in order, a song that matches counts, and one no artist of
 * which matches yet, with an artist never looked up nor [before] asked,
 * asks for those artists; until matched and asking songs add up to [enough].
 */
const ask = <S extends DiscoverRadioSong>(
  songs: readonly S[],
  {
    affinity,
    profileOf,
    before,
    enough,
  }: {
    readonly affinity: DiscoverMixFilter<S>["affinity"];
    readonly profileOf: GenreProfileOf;
    readonly before: ReadonlySet<string>;
    readonly enough: number;
  },
): Asking => {
  const names: string[] = [];
  const asking = new Set<string>();
  let matched = 0;
  let pending = 0;
  for (const song of songs) {
    if (matched + pending >= enough) break;
    if ((affinity?.(song) ?? "match") === "match") {
      matched += 1;
      continue;
    }
    // Names that aren't an artist's ("Various Artists") are never looked up.
    const unseen = song.artists.filter(
      (artist) =>
        ytArtistQuery(artist) !== null &&
        profileOf(artist) === undefined &&
        !before.has(artistPhotoName(artist)),
    );
    if (unseen.length === 0) continue;
    pending += 1;
    for (const artist of unseen) {
      const key = artistPhotoName(artist);
      if (asking.has(key)) continue;
      asking.add(key);
      names.push(artist);
    }
  }
  return { names, matched };
};

/**
 * The artists of [radio] to look up next for a mix that leaves out what
 * [filter] does (`discoverMixSongs`): walking the radio in order, the songs
 * the mix would keep whose genre isn't decided yet (no artist matches, and
 * one was never looked up: [profileOf] undefined) ask for their artists never
 * looked up, until the songs that match and those asking add up to [enough]
 * (the mix's most songs, 50, so mixes stay as long). The songs a refresh
 * avoids ask only when the others leave the mix short of its ten songs.
 * Empty once [enough] songs match, or nothing is left to ask. Artists
 * [asked] already (a lookup that failed, or none made with the Lyrics and
 * genre switch off) aren't asked again.
 */
export const mixProfileLookupsNext = <S extends DiscoverRadioSong>(
  radio: readonly S[],
  {
    filter,
    profileOf,
    asked = [],
    enough = MIX_MOST,
  }: {
    readonly filter: DiscoverMixFilter<S>;
    readonly profileOf: GenreProfileOf;
    /** The names asked for already, as this gave them. */
    readonly asked?: readonly string[];
    readonly enough?: number;
  },
): string[] => {
  const fresh: S[] = [];
  const avoided: S[] = [];
  const videos = new Set(filter.taken);
  const recordings = new Set<string>();
  for (const song of radio) {
    // What `discoverMixSongs` leaves out whatever the genre.
    const recording = mixRecordingOf(song);
    if (song.video || videos.has(song.videoId) || recordings.has(recording)) continue;
    if (filter.known(song)) continue;
    videos.add(song.videoId);
    recordings.add(recording);
    (filter.avoid?.has(song.videoId) === true ? avoided : fresh).push(song);
  }
  const walk = {
    affinity: filter.affinity,
    profileOf,
    before: new Set(asked.map(artistPhotoName)),
  };
  const first = ask(fresh, { ...walk, enough });
  if (first.names.length > 0 || first.matched >= MIX_FEWEST) return first.names;
  return ask(avoided, { ...walk, enough: MIX_FEWEST - first.matched }).names;
};

/**
 * How many YouTube Music candidates a Magic Queue batch wants to pick from:
 * two batches' worth, so even a batch YouTube Music fills alone has a choice.
 */
const MAGIC_CANDIDATES_WANTED = 20;

/**
 * The artists of [session]'s [radio] to look up next (`magicYtCandidates`
 * keeps only the songs that match): as a mix asks (`mixProfileLookupsNext`),
 * until 20 candidates match, leaving out the songs the Library has
 * ([inLibrary]). Artists further down the radio wait for a later batch.
 */
export const magicRadioLookups = <S extends DiscoverRadioSong>(
  session: MagicSession,
  radio: readonly S[],
  {
    profileOf,
    inLibrary,
    asked = [],
  }: {
    readonly profileOf: GenreProfileOf;
    readonly inLibrary: (song: S) => boolean;
    readonly asked?: readonly string[];
  },
): string[] => {
  const used = new Set(session.used);
  const excluded = new Set(session.excludedArtists);
  // Songs no batch picks: the Library's, those queued already and those by excluded artists.
  const known = (song: S) =>
    inLibrary(song) ||
    used.has(ytTrackId(song.videoId)) ||
    song.artists.some((artist) => excluded.has(magicArtistKey(artist)));
  return mixProfileLookupsNext(radio, {
    filter: {
      known,
      taken: new Set(),
      affinity: mixAffinity(magicSeedProfile(session), profileOf),
    },
    profileOf,
    asked,
    enough: MAGIC_CANDIDATES_WANTED,
  });
};
