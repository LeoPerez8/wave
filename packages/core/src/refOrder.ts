/**
 * The last tie-break of rankings that mix Library entries with online ones
 * (streamed songs, YT Music albums and artists), so a full tie never depends
 * on the order the entries arrived in.
 */
import type { TrackRef } from "./ytMusic.ts";

/** An entry's identity: a Library id (a number) or an online one (a string). */
export type RefId = number | string;

/** How Library ids go: the oldest added (lowest) first, or the latest added first. */
export type LibraryIdOrder = "oldest first" | "latest first";

/**
 * Library ids before online ones; Library ids by [library] order, online ids
 * in string order.
 */
export const compareRefIds = (
  a: RefId,
  b: RefId,
  library: LibraryIdOrder = "oldest first",
): number => {
  if (typeof a === "number") {
    if (typeof b !== "number") return -1;
    return library === "oldest first" ? a - b : b - a;
  }
  if (typeof b === "number") return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

const refId = (ref: TrackRef): RefId => (ref.kind === "library" ? ref.id : ref.videoId);

/** `compareRefIds` on songs: a Library song's id, a streamed song's video id. */
export const compareTrackRefs = (
  a: TrackRef,
  b: TrackRef,
  library: LibraryIdOrder = "oldest first",
): number => compareRefIds(refId(a), refId(b), library);
