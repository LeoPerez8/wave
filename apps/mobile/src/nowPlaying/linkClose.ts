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
  let pending: { id: number; hidden: boolean; revealed: boolean } | null = null;
  const finish = () => {
    if (pending === null || !pending.hidden || !pending.revealed) return;
    const { id } = pending;
    pending = null;
    ports.end(id);
  };
  return {
    begin: (id: number | undefined): void => {
      pending = id === undefined ? null : { id, hidden: false, revealed: false };
    },
    reveal: (id: number | undefined): void => {
      if (pending === null || pending.id !== id || pending.revealed) return;
      pending.revealed = true;
      ports.committed(pending.id);
      finish();
    },
    fail: (_id: number | undefined): void => {},
    hidden: (): void => {
      if (pending === null) return;
      pending.hidden = true;
      finish();
    },
  };
};
