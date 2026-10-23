/**
 * Wait across a frame before starting synchronous work. Resolving in the first
 * rAF (or a microtask) can still run that work before the published UI paints.
 * The second frame leaves the intervening frame available for commit and paint.
 */
export const afterPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
