import { formatNumber } from "../formatting.ts";

/** DJ: the screen where the owner picks the artists a Magic Queue starts from. */
export const djEn = {
  title: "DJ",
  /** The line under the title on Discover's DJ card. */
  cardDetail: "A queue made from the artists you pick",
  /** The action at the bottom of Discover's DJ card. */
  cardAction: "Pick artists",
  /** The pill that starts the queue: "Play", then "Play · 3" with 3 tiles selected. */
  play: "Play",
  playCount: (count: number) => `Play · ${count}`,
  close: "Close",
  /** Play's name for screen readers while the first batch is read. */
  starting: "Starting your queue",
  /** An artist tile's name for screen readers: its kind, then the artist. */
  artistTile: (name: string) => `Artist, ${name}`,
  /** An album tile's name for screen readers: its kind, then the album and its artist. */
  albumTile: (title: string, artist: string) => `Album, ${title}, ${artist}`,
  /** A genre family tile's name for screen readers. */
  genreTile: (name: string) => `Genre, ${name}`,
  /** The placeholder tiles' name for screen readers while the chart's artists are on their way. */
  loadingArtists: "Loading artists",
  nothingToPick: "Nothing to pick from yet. Play some music and come back.",
  noSongsFound: "No songs found for what you picked.",
  /** The title of the Adjust sheet, which the bottom bar's summary of it opens. */
  adjust: "Adjust",
  /** The search's back arrow, which returns to the grid. */
  backToGrid: "Back to DJ",
  artistVariety: "Artist variety",
  /** Artist variety's steps: how far the queue strays from the selected artists. */
  varietySteps: { low: "Low", medium: "Medium", high: "High" },
  /** Each Artist variety step as the bottom bar's summary of Adjust names it. */
  varietySummary: { low: "Low variety", medium: "Medium variety", high: "High variety" },
  varietyNotes: {
    low: "Almost only the artists you picked.",
    medium: "The artists you picked and those close to them.",
    high: "A wider circle of artists, each showing up less often.",
  },
  musicDiscovery: "Music discovery",
  /** Music discovery's steps: how much of the queue is new to the owner. */
  discoverySteps: { familiar: "Familiar", blend: "Blend", discover: "Discover" },
  /** The note under Music discovery: the share of new songs the chosen step starts at. */
  discoveryNote: (percent: number) =>
    `${formatNumber("en", percent)}% of the songs are new to you.`,
  /** The group of chips under Adjust's option groups. */
  filters: "Filters",
  mood: "Mood",
  moodNames: { energetic: "Energetic", relaxing: "Relaxing", upbeat: "Upbeat" },
  /** Adjust's filters: Trending and Lesser-known songs lean the queue to hits or deep cuts, New releases to recent records. */
  filterNames: {
    trending: "Trending",
    lesserKnown: "Lesser-known songs",
    newReleases: "New releases",
  },
  /** The grid's search button, and what a screen reader calls its field. */
  search: "Search artists and albums",
  /** What the empty search field says. */
  searchPlaceholder: "Artists, albums",
  /** The search's line when nothing matches what's typed. */
  searchNoMatches: "No artists or albums match.",
  /** Why no result can be added: the selection holds its most ([max]) tiles. */
  searchFull: (max: number) =>
    `You've picked ${max}, the most a queue can start from. Unselect one to add another.`,
  /** The catalog line over the grid's selection row, with how many tiles are selected. */
  selection: (count: number) => `Your selection · ${count}`,
  /** The selection row's line while nothing is selected. */
  selectionEmpty: "Tap artists to start",
  /** A mark of the selection row for screen readers: a tap takes [name] out of the selection. */
  removeFromSelection: (name: string) => `Remove ${name}`,
  /** Under an artist tile whose artist the Library doesn't have. */
  newToYou: "New to you",
  /** The bottom bar's summary of Adjust and its icon for screen readers: they open Adjust. */
  adjustSummary: (summary: string) => `Adjust, ${summary}`,
  /** What Up Next says over a queue started from DJ. */
  magicQueueFromDj: "Magic Queue · from DJ",
};
