/**
 * Whether What's New may still show in this launch, kept apart from its card so the first run can
 * wait for it without loading it with the first screen (#727).
 */

let pending = true;
const listeners = new Set<() => void>();

/** True until What's New has nothing more to show in this launch, or the build has updates off. */
export const isWhatsNewPending = (): boolean => pending;

export const onWhatsNewPendingChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What's New has closed, or had nothing to show. */
export const settleWhatsNew = (): void => {
  if (!pending) return;
  pending = false;
  for (const listener of listeners) listener();
};
