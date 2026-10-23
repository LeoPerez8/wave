import { finishSteps } from "./buildSteps.ts";
import { indexSteps, mapSteps, sortSteps } from "./buildSteps.ts";
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
import { genreMixId } from "./discoverMixes.ts";
import type { MixAffinity } from "./genreAffinity.ts";
import { identityKey } from "./library.ts";
import { freshFirstSteps, type MixRefreshAvoid } from "./mixRefresh.ts";
import { pickWeightedSteps, playsWeight, type RandomSource } from "./weightedPick.ts";
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
      "Rap Metal",
      "Funk Metal",
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
      "Rap Rock",
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
      "Soul & Funk",
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
  ["Latin", ["Reggaeton", "Latin Pop", "Salsa", "Bachata", "Cumbia", "Latin Music"]],
  ["Blues", ["Blues Rock", "Delta Blues", "Electric Blues"]],
  [
    "Soundtrack",
    ["Score", "Film Score", "Original Soundtrack", "OST", "Video Game Music", "Films/Games"],
  ],
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

/** A genre style: the tags of a family that sound alike, under one name. */
export interface GenreStyle {
  /** Tells the style apart from the others (the compacted name). */
  readonly key: string;
  /** Its name, as the level card and the docs say it ("Heavy"). */
  readonly name: string;
}

/**
 * The styles of the families that split (docs/spec.md, Glossary: style):
 * each with its tags, and the styles that sound near it, which Close admits
 * as well as its own. Near is symmetric: a style lists the ones it sounds
 * near, and they list it back. A family not split here keeps one style of
 * its own (`genreStyle`); Rock's and Metal's generic tags have none.
 */
const STYLES: readonly (readonly [
  name: string,
  tags: readonly string[],
  near: readonly string[],
])[] = [
  [
    "Heavy",
    [
      "Heavy Metal",
      "Nu Metal",
      "Alternative Metal",
      "Rap Metal",
      "Rap Rock",
      "Funk Metal",
      "Groove Metal",
      "Industrial Metal",
    ],
    ["Extreme metal", "Metalcore / post-hardcore", "Hard rock / grunge"],
  ],
  [
    "Extreme metal",
    [
      "Death Metal",
      "Melodic Death Metal",
      "Black Metal",
      "Thrash Metal",
      "Doom Metal",
      "Sludge Metal",
      "Post-Metal",
      "Power Metal",
      "Symphonic Metal",
      "Progressive Metal",
      "Djent",
    ],
    ["Heavy", "Metalcore / post-hardcore"],
  ],
  [
    "Metalcore / post-hardcore",
    ["Metalcore", "Deathcore", "Mathcore", "Post-Hardcore", "Hardcore", "Screamo", "Emo"],
    ["Heavy", "Extreme metal"],
  ],
  [
    "Hard rock / grunge",
    ["Hard Rock", "Grunge", "Stoner Rock", "Garage Rock"],
    ["Heavy", "Alternative / indie", "Classic / prog / psych"],
  ],
  [
    "Alternative / indie",
    ["Alternative Rock", "Indie Rock", "Britpop", "Post-Rock"],
    ["Hard rock / grunge", "Soft / acoustic"],
  ],
  [
    "Soft / acoustic",
    ["Soft Rock", "Pop Rock", "Acoustic", "Folk Rock", "Singer-Songwriter", "Indie Folk"],
    ["Alternative / indie"],
  ],
  [
    "Classic / prog / psych",
    ["Classic Rock", "Progressive Rock", "Prog Rock", "Art Rock", "Psychedelic Rock"],
    ["Hard rock / grunge"],
  ],
];

const BY_STYLE: ReadonlyMap<string, GenreStyle> = new Map(
  STYLES.flatMap(([name, tags]) => {
    const style = { key: compact(name), name };
    return tags.map((tag) => [compact(tag), style] as const);
  }),
);

const NEAR: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const near = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    near.set(a, (near.get(a) ?? new Set()).add(b));
  };
  for (const [name, , neighbours] of STYLES)
    for (const other of neighbours) {
      link(compact(name), compact(other));
      link(compact(other), compact(name));
    }
  return near;
})();

/** The families with a style split of their own (`STYLES`'s tags). */
const SPLIT_FAMILIES: ReadonlySet<string> = new Set(
  [...BY_STYLE.keys()].flatMap((key) => BY_TAG.get(key)?.key ?? []),
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
 * The style a genre [tag] belongs to, or null when it has none: a generic
 * tag (a family's own name, "Rock", "Alternative", "Pop") or an unknown one.
 * A tag of a split family is in its listed style (`STYLES`), or none; a tag
 * of a family not split keeps one style of its own, the family's.
 */
export const genreStyle = (tag: string): GenreStyle | null => {
  const key = compact(tag);
  const style = BY_STYLE.get(key);
  if (style !== undefined) return style;
  const family = BY_TAG.get(key);
  if (family === undefined || family.key === key || SPLIT_FAMILIES.has(family.key)) return null;
  return family;
};

/**
 * A song's style (`genreStyle`): the first of its genre values' styles, a
 * value joined as `songFamilies` splits it; null when none has one.
 */
export const songStyle = (song: Pick<DiscoverLibrarySong, "genre" | "genres">): string | null => {
  const values = song.genres?.length ? song.genres : [song.genre ?? ""];
  for (const value of values) {
    const parts = BY_TAG.has(compact(value)) ? [value] : value.split(/[;/]/);
    for (const part of parts) {
      const style = genreStyle(part);
      if (style !== null) return style.key;
    }
  }
  return null;
};

/** The style most of [styles] are (the first met on a tie), ignoring the null ones; null when none is. */
export const commonStyle = (styles: readonly (string | null)[]): string | null => {
  const counts = new Map<string, number>();
  for (const style of styles) if (style) counts.set(style, (counts.get(style) ?? 0) + 1);
  let common: string | null = null;
  let most = 0;
  for (const [style, count] of counts)
    if (count > most) {
      common = style;
      most = count;
    }
  return common;
};

/**
 * How a song's [style] suits a seed's at [level]: the same style, or at Close
 * a neighbouring one, matches; another style misses. Either style unknown is
 * unknown: the song is then admitted only when its artist is close.
 */
export const styleAffinity = (
  seed: string | null,
  style: string | null,
  level: StyleLevel,
): MixAffinity => {
  if (seed === null || style === null) return "unknown";
  if (seed === style) return "match";
  return level === "close" && (NEAR.get(seed)?.has(style) ?? false) ? "match" : "miss";
};

/**
 * How strictly a genre step compares styles (`styleAffinity`): the same
 * style (Same genres), or the same or a neighbouring one (Close).
 */
export type StyleLevel = "same" | "close";

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

/**
 * What a family's song count may fall short of [FAMILY_FEWEST] by and still
 * count: songs in several families add shares (1/3, 1/7…) that don't add up
 * to a whole number exactly in floating point.
 */
const SHARES_ROUNDING = 1e-9;

/** How many of a family's artists a mix grows from at most. */
const SEED_ARTISTS = 3;

/** What Genre mixes are picked from: the Library. */
export interface GenreMixLibrary {
  readonly artists: readonly DiscoverSeedArtist[];
  readonly songs: readonly DiscoverLibrarySong[];
  /** The Library songs' all-time counted plays (songs not listed have none). */
  readonly plays?: readonly DiscoverSongPlays[];
}

/**
 * The families a Library song counts in, each once: those of every value of
 * its genre tag, a value joined with ";" or "/" ("Metalcore; Rock") counting
 * as each of its parts unless the table knows it whole ("Rap/Hip Hop").
 */
export const songFamilies = (
  song: Pick<DiscoverLibrarySong, "genre" | "genres">,
): GenreFamily[] => {
  const families = new Map<string, GenreFamily>();
  const values = song.genres?.length ? song.genres : [song.genre ?? ""];
  for (const value of values) {
    const parts = BY_TAG.has(compact(value)) ? [value] : value.split(/[;/]/);
    for (const part of parts) {
      const family = genreFamily(part);
      if (family !== null && !families.has(family.key)) families.set(family.key, family);
    }
  }
  return [...families.values()];
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

function* libraryFamiliesSteps(library: GenreMixLibrary): Generator<void, RankedFamily[]> {
  const plays = yield* indexSteps(
    library.plays ?? [],
    (entry) => [entry.id, entry.countedPlays] as const,
  );
  const artists = yield* indexSteps(library.artists, (artist) => [artist.id, artist] as const);
  const families = new Map<string, RankedFamily>();
  for (const song of library.songs) {
    yield;
    const ofSong = songFamilies(song);
    const share = 1 / ofSong.length;
    const songPlays = plays.get(song.id) ?? 0;
    for (const family of ofSong) {
      const entry = families.get(family.key) ?? { family, plays: 0, songs: 0, artists: new Map() };
      families.set(family.key, entry);
      entry.plays += songPlays * share;
      entry.songs += share;
      for (const id of song.artistIds) {
        yield;
        const artist = artists.get(id);
        if (artist === undefined) continue;
        const inFamily = entry.artists.get(id) ?? { artist, plays: 0, songs: 0 };
        entry.artists.set(id, inFamily);
        inFamily.plays += songPlays * share;
        inFamily.songs += share;
      }
    }
  }
  return yield* mapSteps(families.values(), (family) => family);
}

/**
 * Up to three of [family]'s artists to grow its mix from, picked by
 * [random] (`pickWeighted`), those most played in the family more likely
 * (`playsWeight`); most played in it first, then those with more songs in
 * it. Names that aren't an artist's ("Various Artists") seed nothing. A
 * refresh ([avoid]) picks from the artists the section didn't show today,
 * then fills up with those it did, the least recently shown first.
 */
function* seedArtistsSteps(
  family: RankedFamily,
  random: RandomSource,
  avoid: MixRefreshAvoid | undefined,
): Generator<void, DiscoverSeedArtist[]> {
  const { fresh, shown } = yield* freshFirstSteps(
    yield* seedableArtistsSteps(family),
    avoid === undefined ? null : ({ artist }) => avoid.artists.get(identityKey(artist.name)),
  );
  const picked = new Set(
    yield* pickWeightedSteps(fresh, SEED_ARTISTS, (artist) => playsWeight(artist.plays), random),
  );
  const selected: FamilyArtist[] = [];
  for (const artist of fresh) {
    if (picked.has(artist)) selected.push(artist);
    yield;
  }
  return [
    ...(yield* sortSteps(selected, (a, b) => b.plays - a.plays || b.songs - a.songs)),
    ...shown.slice(0, SEED_ARTISTS - picked.size),
  ].map(({ artist }) => ({ id: artist.id, name: artist.name }));
}

/** [family]'s artists whose names are an artist's. */
function* seedableArtistsSteps(family: RankedFamily): Generator<void, FamilyArtist[]> {
  const eligible: FamilyArtist[] = [];
  for (const entry of family.artists.values()) {
    if (ytArtistQuery(entry.artist.name) !== null) eligible.push(entry);
    yield;
  }
  return eligible;
}

/**
 * Genre mixes' seeds, four at most, one per genre family: the families with
 * five or more Library songs, most played first (their songs' counted
 * plays), then those with more songs. Each grows from up to three of its
 * artists (`seedArtists`); a family with none that may seed has no mix.
 * Every seed is from "plays" once any Library song has counted plays (the
 * ranking used them), else from "library".
 *
 * A refresh ([avoid], `mixRefreshAvoid`) keeps the families while there are
 * four at most, growing them from other artists; with more, it brings in the
 * families the section didn't show today first, then those it did, the
 * least recently shown first. The mixes stay in the families' order.
 */
export const genreMixSeeds = (
  library: GenreMixLibrary,
  random: RandomSource,
  avoid?: MixRefreshAvoid,
): DiscoverMixSeed[] => finishSteps(genreMixSeedsSteps(library, random, avoid));

export function* genreMixSeedsSteps(
  library: GenreMixLibrary,
  random: RandomSource,
  avoid?: MixRefreshAvoid,
): Generator<void, DiscoverMixSeed[]> {
  const seeds: DiscoverMixSeed[] = [];
  const eligible: RankedFamily[] = [];
  for (const family of yield* libraryFamiliesSteps(library)) {
    if (
      family.songs >= FAMILY_FEWEST - SHARES_ROUNDING &&
      (yield* seedableArtistsSteps(family)).length > 0
    )
      eligible.push(family);
    yield;
  }
  const ranked = yield* sortSteps(eligible, (a, b) => b.plays - a.plays || b.songs - a.songs);
  const { fresh, shown } = yield* freshFirstSteps(
    ranked,
    avoid === undefined ? null : ({ family }) => avoid.mixes.get(genreMixId(family.key)),
  );
  const chosen = new Set([...fresh, ...shown].slice(0, GENRE_MIX_COUNT));
  // The families are ranked by plays once there are any, whichever families
  // they fell in: a build then counts as from plays, so the first plays
  // (`discoverMixesDue`) bring one rebuild, not one on every visit.
  let played = false;
  for (const entry of library.plays ?? []) {
    if (entry.countedPlays > 0) {
      played = true;
      break;
    }
    yield;
  }
  for (const family of ranked) {
    if (!chosen.has(family)) continue;
    const artists = yield* seedArtistsSteps(family, random, avoid);
    const { key, name } = family.family;
    seeds.push({
      kind: "genre",
      id: genreMixId(key),
      name,
      from: played ? "plays" : "library",
      genre: name,
      artists,
    });
  }
  return seeds;
}

export function* commonStyleSteps(styles: Iterable<string | null>): Generator<void, string | null> {
  const counts = new Map<string, number>();
  for (const style of styles) {
    if (style) counts.set(style, (counts.get(style) ?? 0) + 1);
    yield;
  }
  let common: string | null = null,
    most = 0;
  for (const [style, count] of counts) {
    if (count > most) {
      common = style;
      most = count;
    }
    yield;
  }
  return common;
}
