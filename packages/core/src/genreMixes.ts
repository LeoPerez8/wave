/**
 * Genre mixes (docs/spec.md, "Genre mixes"): Home's mixes that each sound
 * like a genre family rather than one band. Core maps the Library's genre
 * tags to families, ranks the families and picks each one's seed artists;
 * the radios, the songs a mix keeps and its Library pool are the mixes'
 * shared rules (`discoverMixes.ts`, `discoverMixLevels.ts`).
 */

import type {
  DiscoverLibrarySong,
  DiscoverMixSeed,
  DiscoverSeedArtist,
  DiscoverSongPlays,
} from "./discoverMixes.ts";
import { pickWeighted, playsWeight, type RandomSource } from "./weightedPick.ts";
import { ytArtistQuery } from "./ytArtist.ts";

/** A genre family: the tags that sound alike, under one name. */
export interface GenreFamily {
  /** Tells the family apart from the others. */
  readonly key: string;
  /** Its name, as a mix's title reads it ("Metal"); an unknown tag's, as typed. */
  readonly name: string;
}

/**
 * The curated families, each with the tags that belong to it (its own name
 * belongs too). Tags are compared without case, spaces or punctuation, so
 * "Hip Hop", "hip-hop" and "HipHop" are one tag.
 */
const FAMILIES: readonly (readonly [name: string, tags: readonly string[]])[] = [
  [
    "Metal",
    [
      "Metalcore",
      "Deathcore",
      "Post-Hardcore",
      "Hardcore",
      "Alternative Metal",
      "Nu Metal",
      "Heavy Metal",
      "Death Metal",
      "Melodic Death Metal",
      "Black Metal",
      "Thrash Metal",
      "Progressive Metal",
      "Power Metal",
      "Doom Metal",
      "Groove Metal",
      "Industrial Metal",
      "Symphonic Metal",
      "Sludge Metal",
      "Post-Metal",
      "Djent",
      "Mathcore",
      "Screamo",
    ],
  ],
  [
    "Rock",
    [
      "Alternative",
      "Alternative Rock",
      "Indie",
      "Indie Rock",
      "Hard Rock",
      "Classic Rock",
      "Progressive Rock",
      "Prog Rock",
      "Post-Rock",
      "Art Rock",
      "Garage Rock",
      "Psychedelic Rock",
      "Stoner Rock",
      "Soft Rock",
      "Pop Rock",
      "Grunge",
      "Britpop",
      "Emo",
      "Rock & Roll",
      "Rock and Roll",
      "Rock n Roll",
    ],
  ],
  ["Punk", ["Punk Rock", "Pop Punk", "Skate Punk", "Post-Punk", "Hardcore Punk"]],
  [
    "Hip-Hop",
    [
      "Hip Hop",
      "Rap",
      "Rap/Hip Hop",
      "Hip-Hop/Rap",
      "Trap",
      "Gangsta Rap",
      "Drill",
      "Boom Bap",
      "Cloud Rap",
      "Emo Rap",
      "Underground Hip Hop",
      "Conscious Hip Hop",
    ],
  ],
  [
    "Pop",
    [
      "Dance Pop",
      "Synthpop",
      "Electropop",
      "Indie Pop",
      "Art Pop",
      "Teen Pop",
      "Power Pop",
      "K-Pop",
      "J-Pop",
    ],
  ],
  [
    "Electronic",
    [
      "Electronica",
      "EDM",
      "Dance",
      "House",
      "Deep House",
      "Techno",
      "Trance",
      "Dubstep",
      "Drum and Bass",
      "Drum & Bass",
      "DnB",
      "Ambient",
      "IDM",
      "Electro",
      "Future Bass",
      "Synthwave",
      "Trip Hop",
      "Downtempo",
      "Breakbeat",
      "Hardstyle",
    ],
  ],
  [
    "R&B",
    [
      "RnB",
      "Rhythm and Blues",
      "Contemporary R&B",
      "Soul",
      "Neo Soul",
      "Funk",
      "Motown",
    ],
  ],
  ["Jazz", ["Smooth Jazz", "Bebop", "Swing", "Jazz Fusion", "Acid Jazz", "Big Band", "Bossa Nova"]],
  [
    "Classical",
    ["Baroque", "Opera", "Orchestral", "Chamber Music", "Contemporary Classical", "Neoclassical"],
  ],
  ["Country", ["Alt-Country", "Americana", "Bluegrass", "Country Pop"]],
  ["Folk", ["Indie Folk", "Folk Rock", "Singer-Songwriter", "Acoustic"]],
  ["Reggae", ["Dancehall", "Dub", "Ska", "Roots Reggae"]],
  ["Latin", ["Reggaeton", "Latin Pop", "Salsa", "Bachata", "Cumbia"]],
  ["Blues", ["Blues Rock", "Delta Blues", "Electric Blues"]],
  ["Soundtrack", ["Score", "Film Score", "Original Soundtrack", "OST", "Video Game Music"]],
];

/** A tag as the table compares it: lowercase letters and digits alone. */
const compact = (tag: string): string =>
  tag
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

const BY_TAG: ReadonlyMap<string, GenreFamily> = new Map(
  FAMILIES.flatMap(([name, tags]) => {
    const family = { key: compact(name), name };
    return [name, ...tags].map((tag) => [compact(tag), family] as const);
  }),
);

/**
 * The family a genre [tag] belongs to (matched without case, spaces or
 * punctuation), from Core's curated table; an unknown tag is its own family,
 * named as typed. Null for no tag.
 */
export const genreFamily = (tag: string): GenreFamily | null => {
  const key = compact(tag);
  if (key === "") return null;
  return BY_TAG.get(key) ?? { key, name: tag.trim().replace(/\s+/g, " ") };
};

/**
 * A genre mix's [radios] (one per seed artist, in the seeds' order) as one
 * list: they take turns giving their next song, a radio that runs out
 * dropping out. What a mix keeps of it is `discoverMixSongs`'s.
 */
export const interleaveRadios = <S>(radios: readonly (readonly S[])[]): S[] => {
  const songs: S[] = [];
  const longest = Math.max(0, ...radios.map((radio) => radio.length));
  for (let at = 0; at < longest; at++)
    for (const radio of radios) if (at < radio.length) songs.push(radio[at]!);
  return songs;
};

/** How many Genre mixes Home shows at most. */
export const GENRE_MIX_COUNT = 4;

/** How many Library songs a family needs to have a mix. */
const FAMILY_FEWEST = 5;

/** How many of a family's artists a mix grows from at most. */
const SEED_ARTISTS = 3;

/** What Genre mixes are picked from: the Library. */
export interface GenreMixLibrary {
  readonly artists: readonly DiscoverSeedArtist[];
  readonly songs: readonly DiscoverLibrarySong[];
  /** The Library songs' all-time counted plays (songs not listed have none). */
  readonly plays?: readonly DiscoverSongPlays[];
}

/** The families a Library song counts in. */
const songFamilies = (song: DiscoverLibrarySong): GenreFamily[] => {
  const family = genreFamily(song.genre ?? "");
  return family === null ? [] : [family];
};

/**
 * Whether a Library song is of the genre family named [family] (a seed's
 * `genre`): what a Genre mix's Library pool takes.
 */
export const ofGenreFamily = (family: string): ((song: DiscoverLibrarySong) => boolean) => {
  const key = genreFamily(family)?.key;
  return (song) => key !== undefined && songFamilies(song).some((of) => of.key === key);
};

interface FamilyArtist {
  readonly artist: DiscoverSeedArtist;
  plays: number;
  songs: number;
}

interface RankedFamily {
  readonly family: GenreFamily;
  plays: number;
  songs: number;
  /** Its artists, by id, in the order the Library's songs first name them. */
  readonly artists: Map<number, FamilyArtist>;
}

/**
 * The Library's genre families (`genreFamily`), each with its songs' counted
 * plays, its song count and its artists' plays and songs in it. A song in
 * several families adds an equal share of itself and its plays to each.
 */
const libraryFamilies = (library: GenreMixLibrary): RankedFamily[] => {
  const plays = new Map((library.plays ?? []).map((entry) => [entry.id, entry.countedPlays]));
  const artists = new Map(library.artists.map((artist) => [artist.id, artist]));
  const families = new Map<string, RankedFamily>();
  for (const song of library.songs) {
    const ofSong = songFamilies(song);
    const share = 1 / ofSong.length;
    const songPlays = plays.get(song.id) ?? 0;
    for (const family of ofSong) {
      const entry = families.get(family.key) ?? { family, plays: 0, songs: 0, artists: new Map() };
      families.set(family.key, entry);
      entry.plays += songPlays * share;
      entry.songs += share;
      for (const id of song.artistIds) {
        const artist = artists.get(id);
        if (artist === undefined) continue;
        const inFamily = entry.artists.get(id) ?? { artist, plays: 0, songs: 0 };
        entry.artists.set(id, inFamily);
        inFamily.plays += songPlays * share;
        inFamily.songs += share;
      }
    }
  }
  return [...families.values()];
};

/**
 * Up to three of [family]'s artists to grow its mix from, picked by
 * [random] (`pickWeighted`), those most played in the family more likely
 * (`playsWeight`); most played in it first, then those with more songs in
 * it. Names that aren't an artist's ("Various Artists") seed nothing.
 */
const seedArtists = (family: RankedFamily, random: RandomSource): DiscoverSeedArtist[] => {
  const artists = [...family.artists.values()].filter(
    ({ artist }) => ytArtistQuery(artist.name) !== null,
  );
  const picked = new Set(
    pickWeighted(artists, SEED_ARTISTS, (artist) => playsWeight(artist.plays), random),
  );
  return (
    artists
      .filter((artist) => picked.has(artist))
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array filter made; Hermes lacks toSorted
      .sort((a, b) => b.plays - a.plays || b.songs - a.songs)
      .map(({ artist }) => ({ id: artist.id, name: artist.name }))
  );
};

/**
 * Genre mixes' seeds, four at most, one per genre family: the families with
 * five or more Library songs, most played first (their songs' counted
 * plays), then those with more songs. Each grows from up to three of its
 * artists (`seedArtists`); a family with none that may seed has no mix.
 */
export const genreMixSeeds = (
  library: GenreMixLibrary,
  random: RandomSource,
): DiscoverMixSeed[] => {
  const seeds: DiscoverMixSeed[] = [];
  const ranked = libraryFamilies(library)
    .filter((family) => family.songs >= FAMILY_FEWEST)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array filter made; Hermes lacks toSorted
    .sort((a, b) => b.plays - a.plays || b.songs - a.songs);
  for (const family of ranked) {
    if (seeds.length === GENRE_MIX_COUNT) break;
    const artists = seedArtists(family, random);
    if (artists.length === 0) continue;
    const { key, name } = family.family;
    seeds.push({
      kind: "genre",
      id: `genre:${key}`,
      name,
      from: family.plays > 0 ? "plays" : "library",
      genre: name,
      artists,
    });
  }
  return seeds;
};
