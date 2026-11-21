/**
 * The YouTube Music artist answers read or saved this session (`yt_artists`),
 * kept in memory so an artist page opened again draws what Wave knows in its
 * first frame instead of waiting on a Library read (docs/spec.md › Fluidity,
 * online screens). Every read and save of an answer passes through here.
 */
import {
  knownPages,
  stepYtArtistSection,
  YT_ARTIST_SECTION_START,
  type YtArtistSaved,
  type YtArtistSection,
  type YtSong,
} from "@wave/core";

/** An answer can hold every song of the artist; a few pages back and forth fit. */
const ANSWERS = knownPages<YtArtistSaved<YtSong>>(16);

/** The answer kept for [artistKey], or undefined when this session hasn't seen one. */
export const keptYtArtist = <S extends YtSong>(artistKey: string): YtArtistSaved<S> | undefined =>
  ANSWERS.get(artistKey) as YtArtistSaved<S> | undefined;

/** Keeps [saved] for [artistKey], unless a newer answer is kept already. */
export const keepYtArtist = (artistKey: string, saved: YtArtistSaved<YtSong> | null): void => {
  if (saved === null) return;
  const kept = ANSWERS.get(artistKey);
  if (kept === undefined || kept.checkedAt <= saved.checkedAt) ANSWERS.set(artistKey, saved);
};

/** Where an artist's section starts: with the kept answer, else reading what was saved. */
export const ytArtistSectionStart = <S extends YtSong>(artistKey: string): YtArtistSection<S> => {
  const kept = keptYtArtist<S>(artistKey);
  return kept === undefined
    ? YT_ARTIST_SECTION_START
    : stepYtArtistSection<S>(YT_ARTIST_SECTION_START, { type: "restored", saved: kept });
};
