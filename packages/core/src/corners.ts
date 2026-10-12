/** A square set inside a rounded shape, in dp. */
export type InsetSquare = {
  /** Corner radius of the outer shape. */
  outerRadius: number;
  /** Gap between the square and the outer shape's side edge. */
  insetX: number;
  /** Gap between the square and the outer shape's top and bottom edges. */
  insetY: number;
  /** Side of the square. */
  size: number;
};

/**
 * Corner radius that makes a square's corners concentric with the rounded
 * shape around it: the outer radius minus the inset, so both curves share a
 * centre. With uneven insets the farther edge sets it, which keeps the
 * square's corner from crowding the outer curve. Never below square corners,
 * never rounder than a circle.
 */
export const concentricRadius = ({ outerRadius, insetX, insetY, size }: InsetSquare): number =>
  Math.min(size / 2, Math.max(0, outerRadius - Math.max(insetX, insetY)));
