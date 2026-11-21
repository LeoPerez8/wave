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
  /** The button beside Done, and the title of the screen it opens. */
  adjust: "Adjust",
  /** Adjust's back arrow, which returns to the grid. */
  backToGrid: "Back to DJ",
  artistVariety: "Artist variety",
  /** Artist variety's steps: how far the queue strays from the selected artists. */
  varietySteps: { low: "Low", medium: "Medium", high: "High" },
  varietyNotes: {
    low: "Almost only the artists you picked.",
    medium: "The artists you picked and those close to them.",
    high: "A wider circle of artists, each showing up less often.",
  },
  musicDiscovery: "Music discovery",
  /** Music discovery's steps: how much of the queue is new to the owner. */
  discoverySteps: { familiar: "Familiar", blend: "Blend", discover: "Discover" },
  /** What Up Next says over a queue started from DJ. */
  magicQueueFromDj: "Magic Queue · from DJ",
};
