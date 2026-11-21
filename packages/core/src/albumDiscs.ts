/** A "Disc n" head an album's tracklist shows before the row at [at]. */
export interface DiscHead {
  readonly disc: number;
  readonly at: number;
}

/**
 * Where an album's tracklist shows its "Disc n" heads (docs/spec.md, Album page), given each
 * row's disc in the order shown: a Library track's disc number (null: untagged, so disc 1), or
 * undefined for a streamed song, which neither leads a disc nor ends one. An album with one
 * disc shows none.
 */
export const albumDiscHeads = (discs: readonly (number | null | undefined)[]): DiscHead[] => {
  const known = discs.filter((disc) => disc !== undefined).map((disc) => disc ?? 1);
  if (new Set(known).size < 2) return [];
  const heads: DiscHead[] = [];
  let current: number | null = null;
  discs.forEach((tagged, at) => {
    if (tagged === undefined) return;
    const disc = tagged ?? 1;
    if (disc !== current) heads.push({ disc, at });
    current = disc;
  });
  return heads;
};
