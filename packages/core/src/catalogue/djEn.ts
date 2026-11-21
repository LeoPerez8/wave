/** DJ: the screen where the owner picks the artists a Magic Queue starts from. */
export const djEn = {
  title: "DJ",
  /** The line under the title on Discover's DJ card. */
  cardDetail: "Pick the artists your queue starts from",
  done: "Done",
  close: "Close",
  /** Done's name for screen readers while the first batch is read. */
  starting: "Starting your queue",
  /** An artist tile's name for screen readers: its kind, then the artist. */
  artistTile: (name: string) => `Artist, ${name}`,
  nothingToPick: "Nothing to pick from yet. Play some music and come back.",
  noSongsFound: "No songs found for these artists.",
  /** What Up Next says over a queue started from DJ. */
  magicQueueFromDj: "Magic Queue · from DJ",
};
