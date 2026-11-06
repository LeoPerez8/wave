/**
 * Settings › Version History (docs/spec.md, Build and CI): the channel's releases with their dates
 * and notes, read from the update service's whole-history answer. The app fetches and draws them.
 */

import { formatDate } from "./formatting.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { versionOrder } from "./updatePolicy.ts";
import { readPublishedNotes, type PublishedRelease } from "./whatsNew.ts";

/** One release from `GET /v1/notes`, with when its notes were published. */
export interface DatedRelease extends PublishedRelease {
  /** Milliseconds since the epoch; null when the service gave none Wave can read. */
  readonly date: number | null;
}

const dateOf = (release: unknown): number | null => {
  const date =
    typeof release === "object" && release !== null ? (release as { date?: unknown }).date : null;
  if (typeof date !== "string") return null;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? null : parsed;
};

/** The service's answer with each release's date, or null when it isn't one. */
export const readVersionHistory = (answer: unknown): readonly DatedRelease[] | null => {
  const releases = readPublishedNotes(answer);
  if (releases === null) return null;
  // readPublishedNotes read every release of the answer, in its order.
  const raw = (answer as { readonly releases: readonly unknown[] }).releases;
  return releases.map((release, index) => ({ ...release, date: dateOf(raw[index]) }));
};

/**
 * The list to keep on the phone (docs/spec.md, Build and CI, Version History), in the service's
 * own answer form, so `readKeptVersionHistory` reads it back as the service's answer is read.
 */
export const keptVersionHistory = (releases: readonly DatedRelease[]): string =>
  JSON.stringify({
    releases: releases.map(({ version, date, notes }) => ({
      version,
      date: date === null ? null : new Date(date).toISOString(),
      notes,
    })),
  });

/** The list `keptVersionHistory` kept, or null when nothing is or it can't be read. */
export const readKeptVersionHistory = (stored: string | null): readonly DatedRelease[] | null => {
  if (stored === null) return null;
  try {
    return readVersionHistory(JSON.parse(stored));
  } catch {
    // Unreadable: as if nothing were kept.
    return null;
  }
};

/**
 * Where the channel's whole history is: on the service the manifest comes from. Null with no
 * channel the service knows (a PR or local build's "none") or no address to go by.
 */
export const versionHistoryUrl = ({
  manifestUrl,
  channel,
}: {
  readonly manifestUrl: string | undefined;
  readonly channel: string | null;
}): string | null => {
  const manifestPath = "/v1/manifest";
  if (channel !== "ti" && channel !== "main") return null;
  if (!manifestUrl?.endsWith(manifestPath)) return null;
  // not UI text: an address
  return `${manifestUrl.slice(0, -manifestPath.length)}/v1/notes?channel=${channel}`;
};

/** A release as the Version History page shows it. */
export interface VersionHistoryEntry {
  readonly version: string;
  /** When its notes were published, as the page says it; null when the service gave none. */
  readonly date: string | null;
  /** The version running now, marked "Current"; any newer one sits above it. */
  readonly current: boolean;
  /** "New" then "Fixes" in Wave's language, as the What's New card says them; an empty one isn't there. */
  readonly sections: readonly VersionHistorySection[];
}

export interface VersionHistorySection {
  readonly title: string;
  readonly lines: readonly string[];
}

const dateLabel = (date: number | null, language: AppLanguage): string | null =>
  date === null
    ? null
    : formatDate(language, date, { day: "numeric", month: "long", year: "numeric" });

/** The channel a version was released on: `-ti` versions on ti, the others on main. */
const channelOf = (version: string): "ti" | "main" => (version.endsWith("-ti") ? "ti" : "main");

/**
 * The page's releases: only the channel's own, so a promoted version's lines don't show twice, and
 * newest first.
 */
export const versionHistoryEntries = ({
  releases,
  runningVersion,
  channel,
  language,
}: {
  readonly releases: readonly DatedRelease[];
  /** The version the running bundle is; null when it can't tell. */
  readonly runningVersion: string | null;
  /** The APK's channel. */
  readonly channel: string | null;
  readonly language: AppLanguage;
}): readonly VersionHistoryEntry[] => {
  const strings = catalogueOf(language).whatsNew;
  return (
    releases
      .filter((release) => channelOf(release.version) === channel)
      .map((release) => ({ release, order: versionOrder(release.version) }))
      .filter((it): it is { release: DatedRelease; order: number } => it.order !== null)
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort((a, b) => b.order - a.order)
      .map(({ release }) => {
        const notes = release.notes[language];
        return {
          version: release.version,
          date: dateLabel(release.date, language),
          current: release.version === runningVersion,
          sections: [
            { title: strings.new, lines: notes.new },
            { title: strings.fixes, lines: notes.fixes },
          ].filter(({ lines }) => lines.length > 0),
        };
      })
  );
};

/**
 * The Settings row's line: the running version's date. Null until the history is read, or when the
 * running version has no notes or no date, which leaves the row with its title alone.
 */
export const versionHistorySummary = ({
  releases,
  ...asked
}: {
  readonly releases: readonly DatedRelease[] | null;
  readonly runningVersion: string | null;
  readonly channel: string | null;
  readonly language: AppLanguage;
}): string | null =>
  releases === null
    ? null
    : (versionHistoryEntries({ releases, ...asked }).find(({ current }) => current)?.date ?? null);
