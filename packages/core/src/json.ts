/**
 * Reading answers parsed from JSON (Spotify's, for one) field by field, for
 * Core's own modules: anything that isn't what a field should be reads as
 * nothing, so a reader falls back instead of trusting a shape it was never
 * promised. Not part of Core's public API.
 */

type Json = Readonly<Record<string, unknown>>;

/** [value] when it's a JSON object (not an array), else null. */
const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;

/** [value] when it's an array, else none. */
export const array = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** [value] trimmed when it's a string with something in it, else null. */
export const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** The field at [path] down from [value], or undefined where any step isn't an object. */
export const at = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((node, key) => object(node)?.[key], value);

/** [value] when it's a finite number above zero, else null. */
export const positive = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
