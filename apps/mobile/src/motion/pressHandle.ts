import { createContext } from "react";

/** A mounted `Press`, as a view wrapping it can drive it. */
export interface PressHandle {
  /** The `Press`'s key: what a card it opens is about (`PressedElement.key`). */
  readonly key: number;
  /**
   * Runs [handler] as this `Press`'s long press (or `opensMenu` press) runs
   * its own: measured where it sits, known by its key, so a card the handler
   * opens floats next to it and highlights it. Resolves with whether it
   * opened one.
   */
  readonly run: (handler: () => void) => Promise<boolean>;
}

/**
 * Inside it, the outermost `Press` hands itself over (and takes itself back,
 * returned, when it unmounts). The Design preview's states open their cards
 * through it, as a long press would. Outside one, a `Press` hands over nothing.
 */
export const HandOverPress = createContext<((press: PressHandle) => () => void) | undefined>(
  undefined,
);
