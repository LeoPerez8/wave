/**
 * Settings › Downloads' run panel: how a big run is going. The run is the
 * songs queued since the queue was last empty: a song joins it when it's seen
 * on its way, and the run resets once nothing is left. It counts the songs
 * done, failed and left, overall and per group (`downloadingList`'s groups),
 * and says how long what's left should take from the pace of the last ~10
 * minutes. The journal forgets a song once it's in the Library and Wave
 * restarts, so the run is followed snapshot by snapshot rather than read off
 * one.
 */

import { downloadGroupKey } from "./downloadGroups.ts";
import type { QueuedDownloadCounts } from "./queuedDownloads.ts";
import type { YtDownloadJournalJob } from "./ytDownloads.ts";

type Outcome = "left" | "done" | "failed";

interface Member {
  /** Its group's key (`DownloadGroup.key`). */
  readonly group: string;
  readonly outcome: Outcome;
}

/** The run as followed so far (`followDownloadRun`); plain data, start from `NO_DOWNLOAD_RUN`. */
export interface DownloadRun {
  /** When its first song was seen on its way; null with no run. */
  readonly startedAt: number | null;
  /** Its songs by journal job id. */
  readonly members: ReadonlyMap<string, Member>;
  /** When its songs finished (done or failed), within the pace's window. */
  readonly finishes: readonly number[];
}

export const NO_DOWNLOAD_RUN: DownloadRun = { startedAt: null, members: new Map(), finishes: [] };

/** How far the time left looks back for the pace (ms). */
export const DOWNLOAD_PACE_WINDOW_MS = 10 * 60_000;
/** The fewest songs finished within the window before the time left shows. */
export const DOWNLOAD_PACE_MIN_SONGS = 3;
/** The least time the pace is measured over before the time left shows (ms). */
export const DOWNLOAD_PACE_MIN_SPAN_MS = 60_000;

/** Where [job] is, as the run counts it; null once it's cancelled. Same kinds as its row's status. */
const outcomeOf = (job: YtDownloadJournalJob): Outcome | null => {
  if (job.phase === "cancelled") return null;
  if (job.importFailure !== undefined || job.phase === "failed") return "failed";
  if (job.phase === "completed" && job.acknowledged === true && job.saved !== undefined)
    return "done";
  return "left";
};

/**
 * [run] once the journal reads [jobs] at [now] (ms). A song seen on its way
 * joins the run; one it already has takes its new outcome (a failed song
 * retried is left again). A song of the run gone from the journal, or
 * cancelled, leaves the run unless it was done (the journal forgets songs
 * once they're in the Library). With nothing left the run is over.
 */
export const followDownloadRun = (
  run: DownloadRun,
  jobs: readonly YtDownloadJournalJob[],
  now: number,
): DownloadRun => {
  const members = new Map<string, Member>();
  const finishes = run.finishes.filter((at) => at > now - DOWNLOAD_PACE_WINDOW_MS);
  let left = 0;
  for (const job of jobs) {
    const outcome = outcomeOf(job);
    if (outcome === null) continue;
    const before = run.members.get(job.id);
    if (before === undefined && outcome !== "left") continue;
    if (outcome === "left") left += 1;
    else if (before?.outcome === "left") finishes.push(now);
    members.set(job.id, {
      group: before?.group ?? downloadGroupKey(job.origin ?? null),
      outcome,
    });
  }
  if (left === 0) return NO_DOWNLOAD_RUN;
  for (const [id, member] of run.members)
    if (member.outcome === "done" && !members.has(id)) members.set(id, member);
  return { startedAt: run.startedAt ?? now, members, finishes };
};

/** How many songs of a run, or of one of its groups, are done, failed and left. */
export interface DownloadRunCounts {
  readonly done: number;
  readonly failed: number;
  readonly left: number;
  readonly total: number;
}

/** The run's counts overall (null with no run) and per group, by `DownloadGroup.key`. */
export interface DownloadRunProgress {
  readonly overall: DownloadRunCounts | null;
  readonly groups: ReadonlyMap<string, DownloadRunCounts>;
}

interface Tally {
  done: number;
  failed: number;
  left: number;
  total: number;
}

const tally = (): Tally => ({ done: 0, failed: 0, left: 0, total: 0 });

const count = (into: Tally, outcome: Outcome) => {
  into[outcome] += 1;
  into.total += 1;
};

/** [run]'s counts, overall and per group. */
export const downloadRunProgress = (run: DownloadRun): DownloadRunProgress => {
  if (run.members.size === 0) return { overall: null, groups: new Map() };
  const overall = tally();
  const groups = new Map<string, Tally>();
  for (const { group, outcome } of run.members.values()) {
    count(overall, outcome);
    let into = groups.get(group);
    if (into === undefined) {
      into = tally();
      groups.set(group, into);
    }
    count(into, outcome);
  }
  return { overall, groups };
};

/**
 * Whether the run is paused: songs are left but none is downloading or
 * saving ([counts], `queuedDownloadCounts`), so nothing moves and no time
 * left can be told.
 */
export const downloadsPaused = (counts: QueuedDownloadCounts): boolean =>
  counts.waiting > 0 && counts.downloading === 0 && counts.saving === 0;

/**
 * How long what's left of [run] should take (ms): the songs finished per
 * minute over the last `DOWNLOAD_PACE_WINDOW_MS` (or since the run started,
 * if later), applied to the songs left. Null with no run, while [paused], and
 * until `DOWNLOAD_PACE_MIN_SONGS` finished over at least
 * `DOWNLOAD_PACE_MIN_SPAN_MS`.
 */
export const downloadTimeLeft = (
  run: DownloadRun,
  { now, paused }: { readonly now: number; readonly paused: boolean },
): number | null => {
  if (paused || run.startedAt === null) return null;
  const since = Math.max(run.startedAt, now - DOWNLOAD_PACE_WINDOW_MS);
  const span = now - since;
  const finished = run.finishes.filter((at) => at > now - DOWNLOAD_PACE_WINDOW_MS).length;
  if (finished < DOWNLOAD_PACE_MIN_SONGS || span < DOWNLOAD_PACE_MIN_SPAN_MS) return null;
  const left = downloadRunProgress(run).overall?.left ?? 0;
  return Math.round((left * span) / finished);
};

/** [ms] left as the panel says it: "About 2 h left", "About 15 min left". */
export const downloadTimeLeftLine = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "Less than a minute left";
  if (minutes < 60) return `About ${minutes} min left`;
  if (minutes >= 180) return `About ${Math.round(minutes / 60).toLocaleString("en")} h left`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes % 60) / 10) * 10;
  if (rest === 0) return `About ${hours} h left`;
  if (rest === 60) return `About ${hours + 1} h left`;
  return `About ${hours} h ${rest} min left`;
};

/** A run's (or group's) counts in words, for the panel and the group headers. */
export interface DownloadRunLines {
  /** "1,234 of 2,500". */
  readonly count: string;
  /** "12 failed · 1,254 left", the failed only when some did. */
  readonly detail: string;
  /** How far along it is, 0 to 1: the songs finished (done or failed) of all. */
  readonly fraction: number;
}

/** [counts] in words. */
export const downloadRunLines = ({
  done,
  failed,
  left,
  total,
}: DownloadRunCounts): DownloadRunLines => ({
  count: `${done.toLocaleString("en")} of ${total.toLocaleString("en")}`,
  detail: [
    ...(failed === 0 ? [] : [`${failed.toLocaleString("en")} failed`]),
    `${left.toLocaleString("en")} left`,
  ].join(" · "),
  fraction: total === 0 ? 0 : (done + failed) / total,
});
