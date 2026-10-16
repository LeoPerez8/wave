/**
 * Fix Songs on the whole Library (docs/spec.md, "Lyrics and genre"):
 * what its progress says, in Settings and in its notification, and its end
 * summary as kept until the owner has seen it.
 */

/** The run's progress: a title, the "N of M" count once the songs are known, and both on one line. */
export interface LibraryLookupProgress {
  readonly title: string;
  readonly detail: string | null;
  readonly line: string;
}

const TITLE = "Fixing songs…";

/** What the run says with [done] of [total] songs fixed; [total] is 0 until they're known. */
export const libraryLookupProgress = (done: number, total: number): LibraryLookupProgress => {
  if (total === 0) return { title: TITLE, detail: null, line: TITLE };
  const detail = `${done.toLocaleString("en")} of ${total.toLocaleString("en")}`;
  return { title: TITLE, detail, line: `${TITLE} ${detail}` };
};

/**
 * How a run went: in full for its notification (Core's `describeTagLookups`),
 * and as the one line Wave's toast says (`tagLookupsToast`).
 */
export interface LibraryLookupSummary {
  readonly title: string;
  readonly message: string;
  readonly toast: string;
}

/** [summary] as stored until the owner has seen it. */
export const writeLibraryLookupSummary = (summary: LibraryLookupSummary): string =>
  JSON.stringify({ title: summary.title, message: summary.message, toast: summary.toast });

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
  const { title, message, toast } = value as Record<string, unknown>;
  if (typeof title !== "string" || typeof message !== "string") return null;
  // One kept by a Wave from before the toast says its title.
  return { title, message, toast: typeof toast === "string" ? toast : title };
};
