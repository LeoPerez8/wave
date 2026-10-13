/**
 * The whole-Library lyrics and genre run (docs/spec.md, "Lyrics and genre"):
 * what its progress says, in Settings and in its notification, and its end
 * summary as kept until the owner has seen it.
 */

/** The run's progress: a title, the "N of M" count once the songs are known, and both on one line. */
export interface LibraryLookupProgress {
  readonly title: string;
  readonly detail: string | null;
  readonly line: string;
}

const TITLE = "Finding lyrics and genre…";

/** What the run says with [done] of [total] songs looked up; [total] is 0 until they're known. */
export const libraryLookupProgress = (done: number, total: number): LibraryLookupProgress => {
  if (total === 0) return { title: TITLE, detail: null, line: TITLE };
  const detail = `${done.toLocaleString("en")} of ${total.toLocaleString("en")}`;
  return { title: TITLE, detail, line: `${TITLE} ${detail}` };
};

/** How a run went, as its end message says it (Core's `describeTagLookups`). */
export interface LibraryLookupSummary {
  readonly title: string;
  readonly message: string;
}

/** [summary] as stored until the owner has seen it. */
export const writeLibraryLookupSummary = (summary: LibraryLookupSummary): string =>
  JSON.stringify({ title: summary.title, message: summary.message });

/** The summary kept in [stored], or null when nothing (or nothing readable) is kept. */
export const readLibraryLookupSummary = (stored: string | null): LibraryLookupSummary | null => {
  if (stored === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { title, message } = value as Record<string, unknown>;
  return typeof title === "string" && typeof message === "string" ? { title, message } : null;
};
