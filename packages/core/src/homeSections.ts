import { en, type Catalogue } from "./catalogueEn.ts";
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
  | "new-releases"
  | "upcoming-shows"
  | "discover"
  | "recently-added"
  | "recently-played"
  | "most-played"
  | "most-played-albums"
  | "most-played-artists"
  | "favorites"
  | "stats";

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
  { id: "new-releases", title: en.newReleases.title, fromPlays: false },
  { id: "upcoming-shows", title: en.upcomingShows.title, fromPlays: false },
  { id: "discover", title: "Discover", fromPlays: false },
  { id: "recently-added", title: "Recently added", fromPlays: false },
  { id: "recently-played", title: "Recently played", fromPlays: true },
  { id: "most-played", title: "Most played", fromPlays: true },
  { id: "most-played-albums", title: "Most played albums", fromPlays: true },
  { id: "most-played-artists", title: "Most played artists", fromPlays: true },
  { id: "favorites", title: "Favorites", fromPlays: false },
  { id: "stats", title: "Stats", fromPlays: false },
];

const sectionOf = (id: HomeSectionId): HomeSection | undefined =>
  HOME_SECTIONS.find((section) => section.id === id);

/** The title of the section [id]. */
export const homeSectionTitle = (id: HomeSectionId, strings: Catalogue = en): string =>
  id === "new-releases"
    ? strings.newReleases.title
    : id === "upcoming-shows"
      ? strings.upcomingShows.title
      : (sectionOf(id)?.title ?? id);

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
 * line saying how to add them back. With an [empty] Library, Home shows its
 * empty state and, under it, only the sections that need no Library (when
 * arranged): Discover, whose Artist mixes can grow from YouTube Music's
 * chart, and the followed artists' New releases and Upcoming Shows.
 */
export const homeItems = (
  { sections: arrangement }: HomeArrangement,
  { nothingPlayed, empty = false }: { readonly nothingPlayed: boolean; readonly empty?: boolean },
): readonly HomeItem[] => {
  if (empty)
    return arrangement
      .filter((id) => id === "discover" || id === "new-releases" || id === "upcoming-shows")
      .map((section) => ({ section }));
  if (arrangement.length === 0) return ["no-sections"];
  const items: HomeItem[] = arrangement.map((id) => ({ section: id }));
  const hintAt = nothingPlayed ? arrangement.findIndex((id) => sectionOf(id)?.fromPlays) : -1;
  if (hintAt !== -1) items.splice(hintAt, 0, "play-hint");
  return items;
};

/** Home's shown sections and Discover rows, each in the owner's order. */
export interface HomeArrangement {
  readonly sections: readonly HomeSectionId[];
  /** Owner-shown rows, independent of whether they currently have content. */
  readonly discoverRows: readonly DiscoverRowId[];
}

/** Home before the owner arranges it: the whole catalogue in its order. */
const DEFAULT_SECTIONS = HOME_SECTIONS.map(({ id }) => id);
const DEFAULT_DISCOVER_ROWS = DISCOVER_ROWS.map(({ id }) => id);
const DEFAULT_HOME_ARRANGEMENT: HomeArrangement = {
  sections: DEFAULT_SECTIONS,
  discoverRows: DEFAULT_DISCOVER_ROWS,
};

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The arrangement a stored value holds: the sections it shows, in its order,
 * those this Wave doesn't know left out (the Magic Queue, Artist mixes and
 * Genre mixes, now Discover's rows, among them). A catalogue section it
 * neither shows nor hides is newer than the arrangement. It shows after the
 * shown section it follows in the catalogue, on top when none does (so
 * Discover, first in the catalogue, is first on every Home arranged before
 * it). Stats and Listening overview merge at the first shown one's place,
 * visible if either was shown. Nothing stored, or anything unreadable, is the default.
 */
export const parseHomeArrangement = (stored: string | null): HomeArrangement => {
  if (stored === null) return DEFAULT_HOME_ARRANGEMENT;
  const { shown, hidden, discover } = readStoredRecord(stored);
  if (!Array.isArray(shown)) return DEFAULT_HOME_ARRANGEMENT;
  const arrangement = knownSections(shown);
  const known = new Set([...arrangement, ...knownSections(Array.isArray(hidden) ? hidden : [])]);
  const newer = HOME_SECTIONS.filter(({ id }) => !known.has(id));
  for (const { id } of newer) {
    const place = DEFAULT_SECTIONS.indexOf(id);
    const before = DEFAULT_SECTIONS.slice(0, place).findLast((earlier) =>
      arrangement.includes(earlier),
    );
    arrangement.splice(before === undefined ? 0 : arrangement.indexOf(before) + 1, 0, id);
  }
  return { sections: arrangement, discoverRows: parseDiscoverRows(discover) };
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
  const id =
    typeof value === "string" && DISCOVER_ONCE.has(value) ? "discover" : currentSectionId(value);
  return isSectionId(id) ? id : null;
};

/** The id shared by a stored section and Home's arrangement migration. */
const currentSectionId = (value: unknown): unknown =>
  value === "listening-overview" ? "stats" : value;

/** The catalogue's sections [values] name, in their order, each once; anything else left out. */
const knownSections = (values: readonly unknown[]): HomeSectionId[] => [
  ...new Set(values.map(currentSectionId).filter(isSectionId)),
];

/**
 * What to store for [arrangement]: null (nothing) for the default. The
 * sections it hides are stored too, so a section added to the catalogue later
 * can tell it's new.
 */
export const storedHomeArrangement = (arrangement: HomeArrangement): string | null =>
  sameOrder(arrangement.sections, DEFAULT_SECTIONS) &&
  sameOrder(arrangement.discoverRows, DEFAULT_DISCOVER_ROWS)
    ? null
    : JSON.stringify({
        shown: arrangement.sections,
        hidden: hiddenHomeSections(arrangement),
        discover: { shown: arrangement.discoverRows, hidden: hiddenDiscoverRows(arrangement) },
      });

/** A change made in Home's editor. */
export type DiscoverRowEdit =
  | { readonly remove: DiscoverRowId }
  | { readonly add: DiscoverRowId }
  | { readonly move: { readonly from: number; readonly to: number } };

export const hiddenDiscoverRows = (arrangement: HomeArrangement): DiscoverRowId[] =>
  DEFAULT_DISCOVER_ROWS.filter((id) => !arrangement.discoverRows.includes(id));

export type HomeArrangementEdit =
  | { readonly discover: DiscoverRowEdit }
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
  if ("discover" in edit) {
    const change = edit.discover;
    const rows = arrangement.discoverRows;
    const discoverRows =
      "remove" in change
        ? rows.length > 1
          ? rows.filter((id) => id !== change.remove)
          : rows
        : "add" in change
          ? rows.includes(change.add)
            ? rows
            : [...rows, change.add]
          : moveItem(rows, change.move.from, change.move.to);
    return { ...arrangement, discoverRows };
  }
  if ("remove" in edit)
    return { ...arrangement, sections: arrangement.sections.filter((id) => id !== edit.remove) };
  if ("add" in edit)
    return arrangement.sections.includes(edit.add)
      ? arrangement
      : { ...arrangement, sections: [...arrangement.sections, edit.add] };
  return { ...arrangement, sections: moveItem(arrangement.sections, edit.move.from, edit.move.to) };
};

/** The catalogue's sections [arrangement] doesn't show, in catalogue order. */
export const hiddenHomeSections = (arrangement: HomeArrangement): HomeSectionId[] =>
  DEFAULT_SECTIONS.filter((id) => !arrangement.sections.includes(id));

/** Missing row metadata predates editable rows. Unknown ids and duplicates are discarded. */
const parseDiscoverRows = (value: unknown): readonly DiscoverRowId[] => {
  if (typeof value !== "object" || value === null) return DEFAULT_DISCOVER_ROWS;
  const { shown, hidden } = value as { shown?: unknown; hidden?: unknown };
  if (!Array.isArray(shown)) return DEFAULT_DISCOVER_ROWS;
  const knownRows = (values: readonly unknown[]) => [
    ...new Set(
      values.filter((candidate): candidate is DiscoverRowId =>
        DISCOVER_ROWS.some(({ id }) => id === candidate),
      ),
    ),
  ];
  const rows = knownRows(shown);
  const known = new Set([...rows, ...knownRows(Array.isArray(hidden) ? hidden : [])]);
  for (const id of DEFAULT_DISCOVER_ROWS) {
    if (known.has(id)) continue;
    const before = DEFAULT_DISCOVER_ROWS.slice(0, DEFAULT_DISCOVER_ROWS.indexOf(id)).findLast(
      (earlier) => rows.includes(earlier),
    );
    rows.splice(before === undefined ? 0 : rows.indexOf(before) + 1, 0, id);
  }
  return rows.length === 0 ? DEFAULT_DISCOVER_ROWS : rows;
};

/**
 * Owner-shown mixes build and rerank. An empty Library's shown Magic Queue
 * also needs Artist mixes, even with their row removed. Order affects drawing only.
 */
export const discoverMixRowsToBuild = (
  rows: readonly DiscoverRowId[],
  { empty }: { readonly empty: boolean },
): MixRowId[] =>
  (["artist-mixes", "genre-mixes"] as const).filter(
    (id) => rows.includes(id) || (id === "artist-mixes" && empty && rows.includes("magic-queue")),
  );
