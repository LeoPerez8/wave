/**
 * The What's New card (docs/spec.md, Build and CI): reading the update service's notes, merging the
 * ones a phone received together, and when the card shows. The app carries the step out.
 */

import type { AppLanguage } from "./localisation.ts";

export interface ReleaseNoteSections {
  readonly new: readonly string[];
  readonly fixes: readonly string[];
}

/** One release from `GET /v1/notes`. */
export interface PublishedRelease {
  readonly version: string;
  readonly notes: Readonly<Record<AppLanguage, ReleaseNoteSections>>;
}

/** Everything a phone received, as one card says it. */
export interface MergedReleaseNotes {
  /** The newest version the notes cover. */
  readonly version: string;
  readonly new: readonly string[];
  readonly fixes: readonly string[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const lines = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : [];

const sections = (value: unknown): ReleaseNoteSections | null => {
  const read = record(value);
  return read && { new: lines(read.new), fixes: lines(read.fixes) };
};

/** The service's answer, or null when it isn't one, which counts as a failed fetch. */
export const readPublishedNotes = (answer: unknown): readonly PublishedRelease[] | null => {
  const releases = record(answer)?.releases;
  if (!Array.isArray(releases)) return null;
  const read: PublishedRelease[] = [];
  for (const candidate of releases) {
    const release = record(candidate);
    const notes = record(release?.notes);
    const en = sections(notes?.en);
    if (typeof release?.version !== "string" || en === null) return null;
    read.push({
      version: release.version,
      notes: { en, "pt-BR": sections(notes?.["pt-BR"]) ?? en },
    });
  }
  return read;
};

/**
 * The notes of [releases], which the service sends newest first, in [language], a line two of them
 * share said once. Null when none of them has a line.
 */
export const mergeReleaseNotes = (
  releases: readonly PublishedRelease[],
  language: AppLanguage,
): MergedReleaseNotes | null => {
  const merged = (section: keyof ReleaseNoteSections): readonly string[] => [
    ...new Set(releases.flatMap(({ notes }) => notes[language][section])),
  ];
  const newest = releases[0];
  const added = merged("new");
  const fixes = merged("fixes");
  if (newest === undefined || (added.length === 0 && fixes.length === 0)) return null;
  return { version: newest.version, new: added, fixes };
};

/**
 * Where the notes after [from], up to [to], are: on the service the manifest comes from. Null with
 * no channel the service knows (a PR build's "none") or no address to go by.
 */
export const whatsNewNotesUrl = ({
  manifestUrl,
  channel,
  from,
  to,
}: {
  readonly manifestUrl: string | undefined;
  readonly channel: string | null;
  readonly from: string;
  readonly to: string;
}): string | null => {
  const manifestPath = "/v1/manifest";
  if (channel !== "ti" && channel !== "main") return null;
  if (!manifestUrl?.endsWith(manifestPath)) return null;
  const service = manifestUrl.slice(0, -manifestPath.length);
  return `${service}/v1/notes?channel=${channel}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};

/** After a failed fetch, the next one waits at least this long, or for the next launch. */
export const WHATS_NEW_RETRY_MS = 15 * 60_000;

export interface WhatsNewState {
  /** The version the running bundle is; null when it can't tell. */
  readonly runningVersion: string | null;
  /** The newest version whose notes were dealt with; null on a fresh install. Kept across launches. */
  readonly seenVersion: string | null;
  /** Wave is in the foreground. */
  readonly visible: boolean;
  /** Now Playing is up, or on its way up or down. */
  readonly nowPlayingShown: boolean;
  /** A card is open, this one included. */
  readonly cardOpen: boolean;
  readonly fetching: boolean;
  /** The notes have arrived and have something to say. */
  readonly notesReady: boolean;
  /** The What's New card is open. */
  readonly showing: boolean;
  readonly now: number;
  /** When the last fetch failed, in this launch; null when none has. */
  readonly lastFailureAt: number | null;
}

/**
 * `remember` keeps the running version as seen, `finished` means there's nothing more to do in this
 * launch. A card that comes down with `hide` isn't seen: it comes back later.
 */
export type WhatsNewStep = "remember" | "fetch" | "show" | "hide" | "wait" | "finished";

/** A version's place in the sequence ti and main share; null if it isn't a version. */
const versionParts = (version: string): readonly [number, number, number] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-ti)?$/.exec(version);
  return match && [Number(match[1]), Number(match[2]), Number(match[3])];
};

const isAfter = (
  [major, minor, patch]: readonly [number, number, number],
  [seenMajor, seenMinor, seenPatch]: readonly [number, number, number],
): boolean =>
  major !== seenMajor
    ? major > seenMajor
    : minor !== seenMinor
      ? minor > seenMinor
      : patch > seenPatch;

const retryIsDue = ({ now, lastFailureAt }: WhatsNewState): boolean =>
  lastFailureAt === null ||
  // A clock set back would otherwise hold the retry off until it caught up.
  now < lastFailureAt ||
  now - lastFailureAt >= WHATS_NEW_RETRY_MS;

/**
 * What to do now about the card. Seen moves only when the card is dismissed (or there's nothing to
 * say), so a JS reload neither loses the card nor brings back a dismissed one, and a version older
 * than the seen one, after a rollback, says nothing and doesn't move it.
 */
export const nextWhatsNewStep = (state: WhatsNewState): WhatsNewStep => {
  const running = state.runningVersion === null ? null : versionParts(state.runningVersion);
  if (running === null) return "finished";
  const seen = state.seenVersion === null ? null : versionParts(state.seenVersion);
  if (seen === null) return "remember";
  if (!isAfter(running, seen)) return "finished";
  if (state.showing) return state.nowPlayingShown ? "hide" : "wait";
  if (state.fetching || !state.visible) return "wait";
  if (!state.notesReady) return retryIsDue(state) ? "fetch" : "wait";
  return state.nowPlayingShown || state.cardOpen ? "wait" : "show";
};
