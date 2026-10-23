import type { SheetEvent, SheetStep } from "@wave/core";

/** The native adapter starts the close; the link runs on this same JS turn. */
export const followNowPlayingLink = (action: {
  readonly step: (event: SheetEvent) => SheetStep;
  readonly navigate: () => void;
}): void => {
  if (action.step({ type: "linkClose" }).navigateNow) action.navigate();
};

/** A cold link can discover that closing the sheet reveals its destination. */
export const createLinkRevealCompletion = (ports: {
  readonly committed: (id: number) => void;
  readonly end: (id: number) => void;
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
    hidden: (): void => {
      if (pending === null) return;
      pending.hidden = true;
      finish();
    },
  };
};
