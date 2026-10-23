/** A menu invalidates the player's callbacks for the whole originating touch. */
export interface MenuTouchOwnership {
  readonly revision: number;
  readonly held: boolean;
}

/** Safe on either the UI or JS thread, including after the menu has closed. */
export const playerTouchAllowed = (owner: MenuTouchOwnership, revision: number): boolean => {
  "worklet";
  return !owner.held && owner.revision === revision;
};

/**
 * Capture the revision when a player gesture begins. Claiming a long press
 * invalidates it permanently; release/cancel admits only fresh gestures.
 */
export const createMenuTouchOwnership = () => {
  let owner: MenuTouchOwnership = { revision: 0, held: false };
  return {
    get: (): MenuTouchOwnership => owner,
    claim: (): void => {
      owner = { revision: owner.revision + 1, held: true };
    },
    release: (): void => {
      owner = { ...owner, held: false };
    },
    allows: (revision: number): boolean => playerTouchAllowed(owner, revision),
  };
};
