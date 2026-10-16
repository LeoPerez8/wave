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
  | "recently-added"
  | "recently-played"
  | "most-played"
  | "most-played-albums"
  | "most-played-artists"
  | "discover-mixes"
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
  /** It shows only while YT Music is on in Settings. */
  readonly needsYtMusic?: boolean;
}

/**
 * Every section Home can show, in the default order (Home as it was before it
 * could be edited). A section added here shows on every Home by default, even
 * one the owner arranged before it existed (see `parseHomeArrangement`).
 */
export const HOME_SECTIONS: readonly HomeSection[] = [
  { id: "recently-added", title: "Recently added", fromPlays: false },
  { id: "recently-played", title: "Recently played", fromPlays: true },
  { id: "most-played", title: "Most played", fromPlays: true },
  { id: "most-played-albums", title: "Most played albums", fromPlays: true },
  { id: "most-played-artists", title: "Most played artists", fromPlays: true },
  { id: "discover-mixes", title: "Discover mixes", fromPlays: true, needsYtMusic: true },
  { id: "favorites", title: "Favorites", fromPlays: false },
  { id: "stats", title: "Stats", fromPlays: false },
  { id: "listening-overview", title: "Listening overview", fromPlays: false },
];

const sectionOf = (id: HomeSectionId): HomeSection | undefined =>
  HOME_SECTIONS.find((section) => section.id === id);

/** The title of the section [id]. */
export const homeSectionTitle = (id: HomeSectionId): string => sectionOf(id)?.title ?? id;

/**
 * What Home's editor says beside the section [id], or null: a section that
 * needs YT Music says so while it's off (it keeps its place, and shows again
 * once YT Music is on).
 */
export const homeSectionNote = (
  id: HomeSectionId,
  { ytMusic }: { readonly ytMusic: boolean },
): string | null => (!ytMusic && sectionOf(id)?.needsYtMusic === true ? "Needs YT Music" : null);

/**
 * One thing Home lists: a section of the catalogue (drawn only when it has
 * something to show), the line asking for a first play, or the line saying a
 * long press on Home's title adds sections back.
 */
export type HomeItem = { readonly section: HomeSectionId } | "play-hint" | "no-sections";

/**
 * What Home lists for [arrangement]: its sections in order. With nothing
 * played yet, a line asking for a play comes before the first section plays
 * fill (where those sections would be). With YT Music off, the sections
 * that need it aren't listed. With every section removed, the line saying
 * how to add them back.
 */
export const homeItems = (
  arrangement: HomeArrangement,
  { nothingPlayed, ytMusic }: { readonly nothingPlayed: boolean; readonly ytMusic: boolean },
): readonly HomeItem[] => {
  if (arrangement.length === 0) return ["no-sections"];
  const listed = arrangement.filter((id) => ytMusic || sectionOf(id)?.needsYtMusic !== true);
  const items: HomeItem[] = listed.map((id) => ({ section: id }));
  const hintAt = nothingPlayed ? listed.findIndex((id) => sectionOf(id)?.fromPlays) : -1;
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
 * those this Wave doesn't know left out. A catalogue section it neither shows
 * nor hides is newer than the arrangement, and shows after the shown section
 * it follows in the catalogue (on top when none does). Nothing stored, or
 * anything unreadable, is the default.
 */
export const parseHomeArrangement = (stored: string | null): HomeArrangement => {
  if (stored === null) return DEFAULT_HOME_ARRANGEMENT;
  const { shown, hidden } = readStoredRecord(stored);
  if (!Array.isArray(shown)) return DEFAULT_HOME_ARRANGEMENT;
  const arrangement = knownSections(shown);
  const known = new Set([...arrangement, ...knownSections(Array.isArray(hidden) ? hidden : [])]);
  DEFAULT_HOME_ARRANGEMENT.forEach((id, place) => {
    if (known.has(id)) return;
    const before = DEFAULT_HOME_ARRANGEMENT.slice(0, place).findLast((earlier) =>
      arrangement.includes(earlier),
    );
    arrangement.splice(before === undefined ? 0 : arrangement.indexOf(before) + 1, 0, id);
  });
  return arrangement;
};

const isSectionId = (value: unknown): value is HomeSectionId =>
  HOME_SECTIONS.some(({ id }) => id === value);

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
