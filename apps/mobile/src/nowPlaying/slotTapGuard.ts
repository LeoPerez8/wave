/**
 * Whether a tap on an edit slot opens its choice card: never on the release
 * that ends a drag of that slot. The button's press and the drag's pan both
 * see that release, in either order, so a drag marks its touch and the next
 * touch on a slot starts clean (a release the pan kept from the button never
 * reaches `tapped`).
 */
export function slotTapGuard() {
  let dragged: number | null = null;
  return {
    /** A finger came down on a slot. */
    touched: (): void => {
      dragged = null;
    },
    /** The finger's hold became a drag of [slot]. */
    dragged: (slot: number): void => {
      dragged = slot;
    },
    /** The finger lifted as a tap on [slot]: whether its card opens. */
    tapped: (slot: number): boolean => {
      const opens = dragged !== slot;
      dragged = null;
      return opens;
    },
  };
}
