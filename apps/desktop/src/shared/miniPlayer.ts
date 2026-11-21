/** The mini player's window as Wave's pages ask for it (`window.wave.miniPlayer`). */
import type { Invoke } from "./bridge.ts";

export interface MiniPlayerContract {
  /** Opens the mini player, or shows the one that is open. */
  readonly "miniPlayer.open": { readonly args: readonly []; readonly result: void };
  readonly "miniPlayer.close": { readonly args: readonly []; readonly result: void };
  /** Brings the main window back; the mini player stays. */
  readonly "miniPlayer.showMain": { readonly args: readonly []; readonly result: void };
}

export const MINI_PLAYER_CALLS = [
  "miniPlayer.open",
  "miniPlayer.close",
  "miniPlayer.showMain",
] as const;

export const miniPlayerBridge = (invoke: Invoke) => ({
  open: () => invoke("miniPlayer.open"),
  close: () => invoke("miniPlayer.close"),
  showMain: () => invoke("miniPlayer.showMain"),
});
