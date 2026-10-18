/**
 * A Recap's music: the song it plays in the background while its stories
 * show, without interrupting what was already playing (docs/spec.md, Recap).
 */

/**
 * The context a Recap's music plays from. Its plays are never on record
 * (`trackPlays`): neither play history nor counted plays, so watching a
 * Recap never adds to what it reports.
 */
export const RECAP_PLAY_CONTEXT = { kind: "recap", id: null } as const;

/**
 * A slide as the music reads it: a Recap's slides (`RecapSlide`), or the app's
 * with their songs loaded. A top-songs slide features its #1.
 */
export interface RecapMusicSlide<Song> {
  readonly kind: string;
  readonly songs?: readonly Song[];
}

/** The song `slide` features, if any. */
const featuredSong = <Song>(slide: RecapMusicSlide<Song> | undefined): Song | null =>
  slide?.kind === "topSongs" ? (slide.songs?.[0] ?? null) : null;

/**
 * The song a Recap plays while slide `index` of `slides` shows: the song
 * that slide features, else the Recap's #1 song (the first any slide
 * features). None (null) when something was playing as the Recap opened,
 * which Wave doesn't interrupt, or when no slide features a song.
 */
export const recapSong = <Song>(
  slides: readonly RecapMusicSlide<Song>[],
  index: number,
  opened: { readonly playingBefore: boolean },
): Song | null => {
  if (opened.playingBefore) return null;
  const featured = featuredSong(slides[index]);
  if (featured !== null) return featured;
  for (const slide of slides) {
    const song = featuredSong(slide);
    if (song !== null) return song;
  }
  return null;
};
