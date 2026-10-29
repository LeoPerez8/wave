import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { DiscoverRowId, MixRowId } from "../homeSections.ts";
import type { MixSliderStep } from "../mixSliders.ts";
import type { DiscoverMixAction } from "../discoverMixActions.ts";

/** Discover on Home: its rows, mixes, the Magic Queue row and the level card. */
export const discoverEn = {
  /** The label over each row. */
  rows: {
    "magic-queue": "Magic Queue",
    "artist-mixes": "Artist mixes",
    "genre-mixes": "Genre mixes",
  } satisfies Record<DiscoverRowId, string>,
  /** A row's pull and its TalkBack action, for new mixes or other songs. */
  refresh: {
    "artist-mixes": "Get new artist mixes",
    "genre-mixes": "Get new genre mixes",
  } satisfies Record<MixRowId, string>,
  otherSongs: "Get other songs",
  updating: "Updating…",
  buildingMixes: "Building your mixes",
  findingSongs: "Finding songs",
  /** A mix's caption and the name a saved copy gets. */
  mixTitle: (name: string) => `${name} mix`,
  songs: (count: number) =>
    plural("en", count, {
      one: `${formatNumber("en", count)} song`,
      other: `${formatNumber("en", count)} songs`,
    }),
  /** A Magic Queue song card's TalkBack label. */
  startMagicQueue: (title: string, artist: string, album: string | null) =>
    `${title} by ${artist}${album ? `, ${album}` : ""}, start Magic Queue`,
  newMixes: "New mixes",
  newSongs: "New songs",
  undo: "Undo",
  searchLimit: (minutes: number) =>
    `Search limit reached · new mixes in about ${formatNumber("en", minutes)} min`,
  openMixFailed: "Couldn't open the mix's actions",
  saveMixFailed: "Couldn't save the mix as a playlist",
  saved: (name: string) => `Saved ${name}`,
  actions: {
    playNext: "Play Next",
    addToQueue: "Add to Queue",
    saveAsPlaylist: "Save as Playlist",
    downloadAlbum: "Download Mix",
    cancelAlbumDownload: "Cancel Download",
    retryFailed: "Retry Failed",
  } satisfies Record<DiscoverMixAction, string>,
  goneTitle: "This mix is gone",
  goneMessage: "Home has today's mixes while YT Music is on.",
  settings: "Discover settings",
  settingsNeedsYtMusic: "Discover settings, needs YT Music",
  newMusic: "New music",
  genreFaithfulness: "Genre faithfulness",
  popularity: "Popularity",
  faithfulnessNote:
    "Same genres excludes known unrelated genres. Close, Balanced and Neighbours lower them less at each step. Wander ignores genre. Unknown genres always stay.",
  /** The new-music levels, 1 to 5, and the share of new songs each gives. */
  levels: {
    1: "Mostly familiar",
    2: "More familiar",
    3: "Balanced",
    4: "Mostly new",
    5: "All new",
  } satisfies Record<MixSliderStep, string>,
  newShare: (percent: number) => `${formatNumber("en", percent)}% new`,
  faithfulnessSteps: {
    1: "Same genres",
    2: "Close",
    3: "Balanced",
    4: "Neighbours",
    5: "Wander",
  } satisfies Record<MixSliderStep, string>,
  popularitySteps: {
    1: "Hits",
    2: "Popular",
    3: "Balanced",
    4: "Lesser known",
    5: "Deep cuts",
  } satisfies Record<MixSliderStep, string>,
};
