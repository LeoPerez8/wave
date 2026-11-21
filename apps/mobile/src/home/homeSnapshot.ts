/**
 * Home's cold-start snapshot (#1353, docs/spec.md › Fluidity): what Home's
 * local sections last showed, saved when the app goes to the background, and
 * read before Home's first render, so a cold start draws the last Home in its
 * first frame (artwork comes from the image cache). Each section draws its
 * snapshot only until its first read this session answers, then shows the
 * read: the same rows keep their places, so nothing in sight moves. While a
 * finger is down the section keeps drawing the snapshot, and swaps when it
 * lifts, so no row moves under a tap or a scroll.
 *
 * Sections kept on the phone already (Discover's mixes, Community playlists,
 * New releases and Upcoming shows) draw their own kept copy in the first
 * frame and aren't repeated here.
 *
 * Format and bounds: Core's `storedHomeSnapshot` (version 2, at most
 * `HOME_SNAPSHOT_MAX_LENGTH`). A missing, old-format or unreadable snapshot
 * is none: Home opens as it does without one, with no error line.
 */
import {
  homeSnapshotList,
  homeSnapshotRecord,
  parseHomeSnapshot,
  storedHomeSnapshot,
  type HomeSnapshot,
  type HomeSnapshotChecks,
  type LibraryTotals,
  type ListeningTotals,
  type MagicQueueSeed,
} from "@wave/core";
import type { PlayableSongRow, PlaylistRow } from "@wave/client";
import type { TopAlbumsAndArtists } from "@wave/client/db/statsQueries";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { fingerDown } from "@/lib/backgroundWork";
import { registerPerfMeta } from "@/perf/perf";

import type { HomeContent } from "./homeOpening";

type Seeds = readonly MagicQueueSeed<PlayableSongRow>[];

/** Stats' totals, kept as numbers so the facts are drawn in the language of the moment. */
export interface StatsTotals {
  readonly library: LibraryTotals;
  readonly listening: ListeningTotals;
}

/** What the snapshot holds, by section. */
export interface HomeSnapshotSections {
  /** Recently added, Recently played, Most played and Favorites (`useHomeContent`). */
  readonly content: HomeContent;
  /** Most played albums and Most played artists. */
  readonly mostPlayed: TopAlbumsAndArtists;
  readonly orbit: Seeds;
  readonly fromYourLibrary: readonly PlaylistRow[];
  readonly stats: StatsTotals;
  /** The Magic Queue carousel's pages; the page in sight is the snapshot's `page`. */
  readonly magicQueue: readonly Seeds[];
}

const KEY = "home.snapshot";

const isList = Array.isArray as (value: unknown) => value is readonly unknown[];
// not UI text: field kinds the snapshot check expects
const songs = homeSnapshotList({ id: "number", title: "string" });
const albums = homeSnapshotList({ id: "number" });
const seeds = homeSnapshotList<Seeds>({ source: "string", song: "object" });
const ranked = homeSnapshotList<readonly { readonly item: unknown }[]>({
  item: "object",
  countedPlays: "number",
});
const rankedWithIds = (value: unknown): boolean =>
  ranked(value) && albums(value.map((entry) => entry.item));

/** Each content list may be missing (not answered when saved), never of the wrong shape. */
const content = (value: unknown): value is HomeContent => {
  if (!homeSnapshotRecord({})(value)) return false;
  const lists = value as Readonly<Record<string, unknown>>;
  const checks: Record<string, (list: unknown) => boolean> = {
    recentlyAdded: albums,
    recentlyPlayed: albums,
    // not UI text: field kinds the snapshot check expects
    mostPlayed: homeSnapshotList({ playCount: "number", title: "string" }),
    favorites: songs,
  };
  return Object.entries(checks).every(
    ([name, check]) => lists[name] === undefined || check(lists[name]),
  );
};

const CHECKS: HomeSnapshotChecks<HomeSnapshotSections> = {
  content,
  mostPlayed: (value): value is TopAlbumsAndArtists =>
    homeSnapshotRecord({ albums: "object", artists: "object" })(value) &&
    rankedWithIds((value as TopAlbumsAndArtists).albums) &&
    rankedWithIds((value as TopAlbumsAndArtists).artists),
  orbit: seeds,
  fromYourLibrary: homeSnapshotList({
    id: "number",
    name: "string",
    trackCount: "number",
    thumbPaths: "object",
  }),
  // not UI text: field kinds the snapshot check expects
  stats: (value): value is StatsTotals =>
    homeSnapshotRecord({ library: "object", listening: "object" })(value) &&
    homeSnapshotRecord({ songs: "number", albums: "number", artists: "number" })(
      (value as StatsTotals).library,
    ) &&
    homeSnapshotRecord({
      minutesListened: "number",
      songsListened: "number",
      plays: "number",
      lastPlayedAt: "number?",
    })((value as StatsTotals).listening),
  magicQueue: (value): value is readonly Seeds[] => isList(value) && value.every(seeds),
};

/** The snapshot as read at startup; sections leave it as their reads answer. */
let cold: HomeSnapshot<HomeSnapshotSections> | null | undefined;
let coldLength = 0;

const coldStart = (): HomeSnapshot<HomeSnapshotSections> | null => {
  if (cold !== undefined) return cold;
  try {
    const stored = Storage.getItemSync(KEY);
    coldLength = stored?.length ?? 0;
    cold = parseHomeSnapshot(stored, CHECKS);
  } catch {
    // Storage that can't be read is no snapshot: Home opens as it would without one.
    cold = null;
  }
  return cold;
};

/** What each section showed last this session, saved when the app leaves. */
const live: { -readonly [K in keyof HomeSnapshotSections]?: HomeSnapshotSections[K] } = {};
let livePage: number | null = null;

/** The section [name] as the snapshot holds it, until its first read this session answers. */
export const snapshotSection = <K extends keyof HomeSnapshotSections>(
  name: K,
): HomeSnapshotSections[K] | undefined =>
  live[name] === undefined ? coldStart()?.sections[name] : undefined;

/**
 * Home's section [name]: [value] once its read answers (noted for the next
 * snapshot), the snapshot's until then. A section drawing the snapshot keeps
 * it while a finger is down, and shows the read when the finger lifts.
 */
export const useSnapshotted = <K extends keyof HomeSnapshotSections>(
  name: K,
  value: HomeSnapshotSections[K] | undefined,
): HomeSnapshotSections[K] | undefined => {
  const held = useSyncExternalStore(fingerDown.subscribe, fingerDown.isDown);
  const snapshot = snapshotSection(name);
  const shown = value === undefined || (held && snapshot !== undefined) ? snapshot : value;
  const showsRead = value !== undefined && shown === value;
  useEffect(() => {
    if (!showsRead) return;
    live[name] = value;
    // The snapshot's copy is drawn no more: let it go.
    if (cold?.sections[name] !== undefined)
      cold = { ...cold, sections: { ...cold.sections, [name]: undefined } };
  }, [name, value, showsRead]);
  return shown;
};

/** The carousel's page in sight at the last save, until the carousel shows one this session. */
export const snapshotCarouselPage = (): number | null => livePage ?? coldStart()?.page ?? null;

/** The carousel's page in sight, for the next snapshot. */
export const noteCarouselPage = (page: number): void => {
  livePage = page;
};

/** Saves what Home shows now; a snapshot over its bound, or with nothing in it, is removed. */
const saveHomeSnapshot = (): void => {
  const sections = { ...coldStart()?.sections, ...live };
  const stored = storedHomeSnapshot<HomeSnapshotSections>({
    savedAt: Date.now(),
    page: snapshotCarouselPage(),
    sections,
  });
  // Written off the JS thread; a failed write leaves the last snapshot, which still opens Home.
  void (stored === null ? Storage.removeItem(KEY) : Storage.setItem(KEY, stored)).catch(() => {});
};

let saving = false;

/** Saves the snapshot each time the app goes to the background, from Home's first render on. */
export const startSavingHomeSnapshot = (): void => {
  if (saving) return;
  saving = true;
  AppState.addEventListener("change", (state) => {
    if (state === "background") saveHomeSnapshot();
  });
};

registerPerfMeta("homeSnapshot", () => ({
  storedChars: coldLength,
  coldSections: Object.keys(cold?.sections ?? {}).length,
  liveSections: Object.keys(live).length,
}));
