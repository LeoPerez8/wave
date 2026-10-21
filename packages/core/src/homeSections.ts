/**
 * Home's sections as a catalogue: every section Home can show, with its id,
 * its title and its place in the default order. The owner arranges Home from
 * it (a long press on Home's title), and other screens can draw a section of
 * it by id.
 */

import { moveItem } from "./playlists.ts";
import { readStoredRecord } from "./storedJson.ts";

/** A section of Home's catalogue, by id. */
export type HomeSectionId =
  | "discover"
  | "recently-added"
  | "recently-played"
  | "most-played"
  | "most-played-albums"
  | "most-played-artists"
  | "favorites"
  | "stats"
  | "listening-overview";

/** A catalogue entry. */
export interface HomeSection {
  readonly id: HomeSectionId;
  /** Its heading on Home, and its name in Home's editor. */
  readonly title: string;
  /** It fills from the owner's plays: empty until something is played. */
  readonly fromPlays: boolean;
}

/**
 * Every section Home can show, in the default order. A section added here
 * shows on every Home by default, even one the owner arranged before it
 * existed (see `parseHomeArrangement`). Discover holds the Magic Queue,
 * Artist mixes and Genre mixes rows (`DISCOVER_ROWS`); it took the place of
 * their three sections, so it joins every Home arranged before it on top.
 */
export const HOME_SECTIONS: readonly HomeSection[] = [
  { id: "discover", title: "Discover", fromPlays: false },
  { id: "recently-added", title: "Recently added", fromPlays: false },
  { id: "recently-played", title: "Recently played", fromPlays: true },
  { id: "most-played", title: "Most played", fromPlays: true },
  { id: "most-played-albums", title: "Most played albums", fromPlays: true },
  { id: "most-played-artists", title: "Most played artists", fromPlays: true },
  { id: "favorites", title: "Favorites", fromPlays: false },
  { id: "stats", title: "Stats", fromPlays: false },
  { id: "listening-overview", title: "Listening overview", fromPlays: false },
];

const sectionOf = (id: HomeSectionId): HomeSection | undefined =>
  HOME_SECTIONS.find((section) => section.id === id);

/** The title of the section [id]. */
export const homeSectionTitle = (id: HomeSectionId): string => sectionOf(id)?.title ?? id;

/** A row of Home's Discover section. */
export type DiscoverRowId = "magic-queue" | "artist-mixes" | "genre-mixes";

/** Discover's rows of mixes, which need YT Music on: each builds, saves and blends its own. */
export type MixRowId = Exclude<DiscoverRowId, "magic-queue">;

/** Discover's rows, top to bottom, each with the label over it. */
export const DISCOVER_ROWS: readonly { readonly id: DiscoverRowId; readonly title: string }[] = [
  { id: "magic-queue", title: "Magic Queue" },
  { id: "artist-mixes", title: "Artist mixes" },
  { id: "genre-mixes", title: "Genre mixes" },
];

/** The label over Discover's row [id]. */
export const discoverRowTitle = (id: DiscoverRowId): string =>
  DISCOVER_ROWS.find((row) => row.id === id)?.title ?? id;

/**
 * One thing Home lists: a section of the catalogue (drawn only when it has
 * something to show), the line asking for a first play, or the line saying a
 * long press on Home's title adds sections back.
 */
export type HomeItem = { readonly section: HomeSectionId } | "play-hint" | "no-sections";

/**
 * What Home lists for [arrangement]: its sections in order. With nothing
 * played yet, a line asking for a play comes before the first section plays
 * fill (where those sections would be). With every section removed, the
 * line saying how to add them back.
 */
export const homeItems = (
  arrangement: HomeArrangement,
  { nothingPlayed }: { readonly nothingPlayed: boolean },
): readonly HomeItem[] => {
  if (arrangement.length === 0) return ["no-sections"];
  const items: HomeItem[] = arrangement.map((id) => ({ section: id }));
  const hintAt = nothingPlayed ? arrangement.findIndex((id) => sectionOf(id)?.fromPlays) : -1;
  if (hintAt !== -1) items.splice(hintAt, 0, "play-hint");
  return items;
};

/** The sections Home shows, top to bottom. */
export type HomeArrangement = readonly HomeSectionId[];

/** Home before the owner arranges it: the whole catalogue in its order. */
const DEFAULT_HOME_ARRANGEMENT: HomeArrangement = HOME_SECTIONS.map(({ id }) => id);

const sameOrder = (a: HomeArrangement, b: HomeArrangement): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The arrangement a stored value holds: the sections it shows, in its order,
 * those this Wave doesn't know left out (the Magic Queue, Artist mixes and
 * Genre mixes, now Discover's rows, among them). A catalogue section it
 * neither shows nor hides is newer than the arrangement. It shows after the
 * shown section it follows in the catalogue, on top when none does (so
 * Discover, first in the catalogue, is first on every Home arranged before
 * it). Nothing stored, or anything unreadable, is the default.
 */
export const parseHomeArrangement = (stored: string | null): HomeArrangement => {
  if (stored === null) return DEFAULT_HOME_ARRANGEMENT;
  const { shown, hidden } = readStoredRecord(stored);
  if (!Array.isArray(shown)) return DEFAULT_HOME_ARRANGEMENT;
  const arrangement = knownSections(shown);
  const known = new Set([...arrangement, ...knownSections(Array.isArray(hidden) ? hidden : [])]);
  const newer = HOME_SECTIONS.filter(({ id }) => !known.has(id));
  for (const { id } of newer) {
    const place = DEFAULT_HOME_ARRANGEMENT.indexOf(id);
    const before = DEFAULT_HOME_ARRANGEMENT.slice(0, place).findLast((earlier) =>
      arrangement.includes(earlier),
    );
    arrangement.splice(before === undefined ? 0 : arrangement.indexOf(before) + 1, 0, id);
  }
  return arrangement;
};

const isSectionId = (value: unknown): value is HomeSectionId =>
  HOME_SECTIONS.some(({ id }) => id === value);

/** Ids of sections Discover's rows were, and Discover mixes (Artist mixes before it was renamed). */
const DISCOVER_ONCE: ReadonlySet<string> = new Set([
  "magic-queue",
  "artist-mixes",
  "genre-mixes",
  "discover-mixes",
]);

/**
 * The section a stored id names, by its id today, or null: one of the
 * sections that became Discover's rows names Discover. For a pick of one
 * section (the Library's shelf); a Home arrangement leaves those ids out,
 * so Discover joins it on top.
 */
export const storedHomeSectionId = (value: unknown): HomeSectionId | null => {
  const id = typeof value === "string" && DISCOVER_ONCE.has(value) ? "discover" : value;
  return isSectionId(id) ? id : null;
};

/** The catalogue's sections [values] name, in their order, each once; anything else left out. */
const knownSections = (values: readonly unknown[]): HomeSectionId[] => [
  ...new Set(values.filter(isSectionId)),
];

/**
 * What to store for [arrangement]: null (nothing) for the default. The
 * sections it hides are stored too, so a section added to the catalogue later
 * can tell it's new.
 */
export const storedHomeArrangement = (arrangement: HomeArrangement): string | null =>
  sameOrder(arrangement, DEFAULT_HOME_ARRANGEMENT)
    ? null
    : JSON.stringify({ shown: arrangement, hidden: hiddenHomeSections(arrangement) });

/** A change made in Home's editor. */
export type HomeArrangementEdit =
  | { readonly remove: HomeSectionId }
  | { readonly add: HomeSectionId }
  /** A section dragged from one place among those shown to another (0-based). */
  | { readonly move: { readonly from: number; readonly to: number } };

/**
 * [arrangement] after [edit]: a removed section leaves Home, an added one
 * joins at the bottom, a dragged one lands where it's dropped.
 */
export const editHomeArrangement = (
  arrangement: HomeArrangement,
  edit: HomeArrangementEdit,
): HomeArrangement => {
  if ("remove" in edit) return arrangement.filter((id) => id !== edit.remove);
  if ("add" in edit)
    return arrangement.includes(edit.add) ? arrangement : [...arrangement, edit.add];
  return moveItem(arrangement, edit.move.from, edit.move.to);
};

/** The catalogue's sections [arrangement] doesn't show, in catalogue order. */
export const hiddenHomeSections = (arrangement: HomeArrangement): HomeSectionId[] =>
  DEFAULT_HOME_ARRANGEMENT.filter((id) => !arrangement.includes(id));
