/** How a kept setting's changes reach storage. */
export interface WritePacing {
  /** The write waits this long after the last change, so a run of changes is written once. */
  readonly delayMs: number;
  /**
   * The longest a change waits to be written however many follow it: a
   * steady stream (an import's answers) is then still kept every so often,
   * so a Wave killed meanwhile loses at most that much.
   */
  readonly maxDelayMs?: number;
}

/**
 * How long from [now], a change just made, until the pending write is due,
 * when the first change not yet written was made at [firstChangeAt].
 */
export const pendingWriteDelay = (
  { firstChangeAt, now }: { readonly firstChangeAt: number; readonly now: number },
  { delayMs, maxDelayMs }: WritePacing,
): number =>
  maxDelayMs === undefined
    ? delayMs
    : Math.max(0, Math.min(delayMs, firstChangeAt + maxDelayMs - now));
