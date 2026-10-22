/** Advances resumable CPU work for a clock budget. Scheduling/cancellation belong to the caller. */
export const WORK_SLICE_MS = 6;
export const advanceWork = <A>(
  work: Iterator<void, A>,
  now: () => number,
  budgetMs = WORK_SLICE_MS,
): IteratorResult<void, A> => {
  const start = now();
  let result: IteratorResult<void, A>;
  do {
    result = work.next();
  } while (!result.done && now() - start < budgetMs);
  return result;
};
