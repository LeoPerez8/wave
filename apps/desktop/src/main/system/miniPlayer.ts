/** The mini player's window: one at a time, opened where it was left (Core's `floatingWindowPosition`). */
import {
  floatingWindowPosition,
  readFloatingWindowPosition,
  storedFloatingWindowPosition,
  type ScreenArea,
  type WindowPosition,
} from "@wave/core";

export const MINI_PLAYER_SIZE = { width: 344, height: 104 } as const;

/** The device-local setting that keeps the position. */
export const MINI_PLAYER_POSITION = "miniPlayer.position";

/** The part of the native window the mini player uses. */
export interface MiniPlayerWindow {
  /** Shows the window and gives it the keyboard. */
  readonly focus: () => void;
  readonly close: () => void;
  readonly position: () => WindowPosition;
  readonly move: (position: WindowPosition) => void;
  /** `moved` after a drag (Windows only), `close` as it closes, `closed` once it is gone. */
  readonly on: (event: "moved" | "close" | "closed", listener: () => void) => void;
}

export const createMiniPlayer = (port: {
  readonly create: (position: WindowPosition) => MiniPlayerWindow;
  /** Every screen's usable area, the primary one first. */
  readonly areas: () => readonly ScreenArea[];
  readonly stored: () => string | null | undefined;
  readonly store: (value: string) => void;
  readonly onScreensChanged: (listener: () => void) => void;
}) => {
  let open: MiniPlayerWindow | undefined;
  const place = (saved: WindowPosition | undefined) =>
    floatingWindowPosition(saved, MINI_PLAYER_SIZE, port.areas());
  port.onScreensChanged(() => {
    if (open === undefined) return;
    const now = open.position();
    const next = place(now);
    if (next.x !== now.x || next.y !== now.y) open.move(next);
  });
  return {
    isOpen: () => open !== undefined,
    window: () => open,
    open: () => {
      if (open === undefined) {
        const created = port.create(place(readFloatingWindowPosition(port.stored())));
        const keep = () => port.store(storedFloatingWindowPosition(created.position()));
        created.on("moved", keep);
        created.on("close", keep);
        created.on("closed", () => {
          if (open === created) open = undefined;
        });
        open = created;
      }
      open.focus();
    },
    close: () => open?.close(),
  };
};

export type MiniPlayer = ReturnType<typeof createMiniPlayer>;
