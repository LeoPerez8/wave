/**
 * Following the native download journal by its changes. With a big queue, copying the whole
 * journal to JS (and comparing it) for every bit of progress freezes Wave, so the journal answers
 * what changed since the revision the reader last saw (`DurableDownloads.changesSince`), and the
 * reader keeps the rest.
 */

/** What changed in the journal since a revision the reader saw. */
export interface JournalChanges<J extends { readonly id: string }> {
  /** The journal's revision now: what the reader asks from next time. */
  readonly revision: number;
  /** Each job that changed since, as it is now. */
  readonly jobs: readonly J[];
  /** Every job's id, in the journal's order, when the order changed since (else null). */
  readonly ids: readonly string[] | null;
}

/**
 * The reader's jobs ([previous]) with [changes] applied: changed jobs replace their old selves,
 * in the journal's order. Unchanged jobs stay the very same objects, and with nothing new the
 * list itself is returned, so what's derived from it needn't be worked out again.
 */
export const applyJournalChanges = <J extends { readonly id: string }>(
  previous: readonly J[],
  changes: JournalChanges<J>,
): readonly J[] => {
  if (changes.jobs.length === 0 && changes.ids === null) return previous;
  const changed = new Map(changes.jobs.map((job) => [job.id, job]));
  if (changes.ids === null) return previous.map((job) => changed.get(job.id) ?? job);
  const known = new Map(previous.map((job) => [job.id, job]));
  return changes.ids.flatMap((id) => {
    const job = changed.get(id) ?? known.get(id);
    return job === undefined ? [] : [job];
  });
};
