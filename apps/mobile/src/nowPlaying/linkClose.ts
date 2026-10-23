import type { SheetEvent, SheetStep } from "@wave/core";

/** The native adapter starts the close; the link runs on this same JS turn. */
export const followNowPlayingLink = (action: {
  readonly step: (event: SheetEvent) => SheetStep;
  readonly navigate: () => void;
}): void => {
  if (action.step({ type: "linkClose" }).navigateNow) action.navigate();
};

/**
 * How a cold artist link's timing ends. A link closing Now Playing may find
 * the page under the sheet is its destination (`reveal`) or open nothing
 * (`fail`); either ends once the sheet has hidden. A long-press menu or swipe
 * no sheet close owns ends at once: a reveal as a surface on screen, a
 * failure dismissed so the screen it was made on settles again.
 */
export const createLinkRevealCompletion = (ports: {
  readonly committed: (id: number) => void;
  readonly end: (id: number) => void;
  /** The tap measured now, if any. */
  readonly current: () => number | undefined;
  /** Ends [id] unmeasured: the tap opened nothing. */
  readonly dismiss: (id: number) => void;
}) => {
  let pending: {
    id: number;
    hidden: boolean;
    outcome: "revealed" | "failed" | null;
  } | null = null;
  const finish = () => {
    if (pending === null || !pending.hidden || pending.outcome === null) return;
    const { id, outcome } = pending;
    pending = null;
    if (outcome === "revealed") ports.end(id);
    else ports.dismiss(id);
  };
  /** [id]'s tap ended in [outcome]: false when no link close owns it. */
  const settle = (id: number | undefined, outcome: "revealed" | "failed"): boolean => {
    if (pending === null || pending.id !== id) return false;
    if (pending.outcome === null) {
      pending.outcome = outcome;
      if (outcome === "revealed") ports.committed(pending.id);
      finish();
    }
    return true;
  };
  /** A stale tap's answer never ends a newer one. */
  const current = (id: number | undefined): id is number =>
    id !== undefined && ports.current() === id;
  return {
    begin: (id: number | undefined): void => {
      pending = id === undefined ? null : { id, hidden: false, outcome: null };
    },
    reveal: (id: number | undefined): void => {
      if (settle(id, "revealed") || !current(id)) return;
      // The page on screen is the destination: it commits as a surface would.
      ports.committed(id);
      ports.end(id);
    },
    fail: (id: number | undefined): void => {
      if (!settle(id, "failed") && current(id)) ports.dismiss(id);
    },
    hidden: (): void => {
      if (pending === null) return;
      pending.hidden = true;
      finish();
    },
  };
};
