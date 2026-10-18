/**
 * Settings › Downloads' run panel: how a big run is going. The run is the
 * songs queued since the queue was last empty: a song joins it when it's seen
 * on its way, and the run resets once nothing is left. It counts the songs
 * done, failed and left, overall and per group (`downloadingList`'s groups),
 * and says how long what's left should take from the pace of the last ~10
 * minutes. The journal forgets a song once it's in the Library and Wave
 * restarts, so the run is followed snapshot by snapshot rather than read off
 * one, and what it counted is kept across a restart (`keptDownloadRun`).
 */

import { downloadGroupKey } from "./downloadGroups.ts";
import { foundNoBetterCopy } from "./qualityReplacement.ts";
import type { QueuedDownloadCounts } from "./queuedDownloads.ts";
import { readStoredRecord } from "./storedJson.ts";
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
  /**
   * Its songs done before Wave restarted, by group key (`restoredDownloadRun`): the journal
   * forgot them once they were in the Library, so only their count is left.
   */
  readonly doneBefore: ReadonlyMap<string, number>;
  /** When its songs finished (done or failed), within the pace's window. */
  readonly finishes: readonly number[];
}

export const NO_DOWNLOAD_RUN: DownloadRun = {
  startedAt: null,
  members: new Map(),
  doneBefore: new Map(),
  finishes: [],
};

/** How far the time left looks back for the pace (ms). */
export const DOWNLOAD_PACE_WINDOW_MS = 10 * 60_000;
/** The fewest songs finished within the window before the time left shows. */
export const DOWNLOAD_PACE_MIN_SONGS = 3;
/** The least time the pace is measured over before the time left shows (ms). */
export const DOWNLOAD_PACE_MIN_SPAN_MS = 60_000;

/**
 * Where [job] is, as the run counts it; null once it's cancelled. Same kinds as its row's status,
 * but a replacement that found no better copy keeps its file and isn't a failure: it's done.
 */
const outcomeOf = (job: YtDownloadJournalJob): Outcome | null => {
  if (job.phase === "cancelled") return null;
  if (foundNoBetterCopy(job)) return "done";
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
  return { startedAt: run.startedAt ?? now, members, doneBefore: run.doneBefore, finishes };
};

/**
 * [run] as the kv-store keeps it across a restart (`restoredDownloadRun` reads it back): its
 * songs done per group and its failed songs by job id. Its songs left are read from the journal
 * again. Null (nothing kept) with no run.
 */
export const keptDownloadRun = (run: DownloadRun): string | null => {
  if (run.startedAt === null) return null;
  const done: Record<string, number> = Object.fromEntries(run.doneBefore);
  const failed: Record<string, string> = {};
  for (const [id, { group, outcome }] of run.members) {
    if (outcome === "done") done[group] = (done[group] ?? 0) + 1;
    else if (outcome === "failed") failed[id] = group;
  }
  return JSON.stringify({ done, failed });
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * The run as Wave starts at [now], from what [stored] kept of it (`keptDownloadRun`): it goes on
 * counting where it was, and still ends once nothing is left. Its pace starts over from [now].
 * Nothing kept, or anything unreadable, is no run.
 */
export const restoredDownloadRun = (stored: string | null, now: number): DownloadRun => {
  const { done, failed } = readStoredRecord(stored);
  if (!isRecord(done) || !isRecord(failed)) return NO_DOWNLOAD_RUN;
  const doneBefore = new Map<string, number>();
  for (const [group, songs] of Object.entries(done)) {
    if (!isCount(songs)) return NO_DOWNLOAD_RUN;
    if (songs > 0) doneBefore.set(group, songs);
  }
  const members = new Map<string, Member>();
  for (const [id, group] of Object.entries(failed))
    if (typeof group === "string") members.set(id, { group, outcome: "failed" });
  if (doneBefore.size === 0 && members.size === 0) return NO_DOWNLOAD_RUN;
  return { startedAt: now, members, doneBefore, finishes: [] };
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

const count = (into: Tally, outcome: Outcome, songs = 1) => {
  into[outcome] += songs;
  into.total += songs;
};

/** [run]'s counts, overall and per group. */
export const downloadRunProgress = (run: DownloadRun): DownloadRunProgress => {
  if (run.members.size === 0 && run.doneBefore.size === 0)
    return { overall: null, groups: new Map() };
  const overall = tally();
  const groups = new Map<string, Tally>();
  const groupOf = (group: string): Tally => {
    let into = groups.get(group);
    if (into === undefined) {
      into = tally();
      groups.set(group, into);
    }
    return into;
  };
  for (const [group, done] of run.doneBefore) {
    count(overall, "done", done);
    count(groupOf(group), "done", done);
  }
  for (const { group, outcome } of run.members.values()) {
    count(overall, outcome);
    count(groupOf(group), outcome);
  }
  return { overall, groups };
};

/** YouTube's pause on downloads as the run reads it: until when (`YtThrottle.pausedUntil`), at [now]. */
export interface YoutubePauseNow {
  readonly youtubePausedUntil: number | null;
  readonly now: number;
}

/**
 * Whether the run is paused, so no time left can be told: YouTube is limiting
 * downloads ([youtube], `ytThrottle`; its songs sit in their slots waiting
 * for the next try), or songs are left but none is downloading or saving
 * ([counts], `queuedDownloadCounts`), so nothing moves.
 */
export const downloadsPaused = (
  counts: QueuedDownloadCounts,
  youtube: YoutubePauseNow = { youtubePausedUntil: null, now: 0 },
): boolean =>
  (youtube.youtubePausedUntil !== null && youtube.youtubePausedUntil > youtube.now) ||
  (counts.waiting > 0 && counts.downloading === 0 && counts.saving === 0);

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

/** [detail] and, when there's one, [time]: "12 failed · 1,254 left · About 2 h left". */
const withTime = (detail: string, time: string | null): string =>
  time === null ? detail : `${detail} · ${time}`;

/** A group header's line: "40 of 120 · 2 failed · 78 left". */
export const downloadRunGroupLine = (counts: DownloadRunCounts): string => {
  const lines = downloadRunLines(counts);
  return `${lines.count} · ${lines.detail}`;
};

/**
 * The run panel's line under its bar ([counts] in words): what's left, then "Paused" while
 * [paused] (`downloadsPaused`), else the [timeLeft] (`downloadTimeLeft`) once there's one. While
 * YouTube's pause is [throttled], its own line says when it tries again, so this adds nothing.
 */
export const downloadRunPanelLine = (
  counts: DownloadRunCounts,
  {
    timeLeft,
    paused,
    throttled,
  }: { readonly timeLeft: number | null; readonly paused: boolean; readonly throttled: boolean },
): string =>
  withTime(
    downloadRunLines(counts).detail,
    throttled
      ? null
      : paused
        ? "Paused"
        : timeLeft === null
          ? null
          : downloadTimeLeftLine(timeLeft),
  );

/**
 * The download notification's run: "Downloading 1,234 of 2,500", the bar's songs finished
 * (done or failed) of all, and "12 failed · 1,254 left · About 2 h left".
 */
export interface DownloadRunNotice {
  readonly title: string;
  readonly text: string;
  readonly finished: number;
  readonly total: number;
}

/**
 * What the download notification shows of the run ([overall], `downloadRunProgress`), with
 * [timeLeft] (`downloadTimeLeft`) once there's one. Null with no run or a one-song run, which
 * keeps the notification's per-song progress.
 */
export const downloadRunNotice = (
  overall: DownloadRunCounts | null,
  timeLeft: number | null,
): DownloadRunNotice | null => {
  if (overall === null || overall.total <= 1) return null;
  const lines = downloadRunLines(overall);
  return {
    title: `Downloading ${lines.count}`,
    text: withTime(lines.detail, timeLeft === null ? null : downloadTimeLeftLine(timeLeft)),
    finished: overall.done + overall.failed,
    total: overall.total,
  };
};
