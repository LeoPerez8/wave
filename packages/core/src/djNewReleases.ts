/**
 * DJ's New releases filter (docs/spec.md, DJ): which songs of a batch belong
 * to a recent release of an artist the session is about, from the albums and
 * singles their saved YouTube Music pages list.
 */
import { artistNeighbourhood, type ArtistGraph } from "./artistGraph.ts";
import { finishSteps, mapSteps, sortSteps } from "./buildSteps.ts";
import { catalogSeedKey } from "./candidateCatalog.ts";
import { identityKey } from "./library.ts";
import type { MagicSession } from "./magicQueue.ts";
import type { RankedRadioSong } from "./radioRanking.ts";
import type { YtArtistPage } from "./ytArtist.ts";

/** What New releases reads of a saved artist page: who it's of, and their albums and singles. */
export type DjReleasePage = Pick<YtArtistPage, "name" | "albums" | "singles">;

/** How much a song on a recent release is raised: a radio's last songs reach its first ten. */
export const DJ_NEW_RELEASE_BOOST = 4;

/** The most saved pages a session's New releases reads. */
export const DJ_RELEASE_PAGES = 60;

/**
 * The artists whose saved pages New releases reads for [session]: the
 * selected ones, then their direct neighbours in [graph], closest first, up
 * to `DJ_RELEASE_PAGES`. None unless [session] is a DJ one with New releases
 * on. The pages are the ones already saved on the phone; none is asked for.
 */
export const djReleaseArtists = (session: MagicSession, graph: ArtistGraph | null): string[] => {
  if (session.dj?.newReleases !== true) return [];
  const near =
    graph === null
      ? []
      : artistNeighbourhood(graph, session.radioArtists, { hops: 1 }).map(({ name }) => name);
  return [...session.radioArtists, ...near].slice(0, DJ_RELEASE_PAGES);
};

/**
 * [ranked] with the songs New releases favours raised, highest score first
 * and ties in their order. Any session but a DJ one with New releases on
 * keeps [ranked] as it is.
 *
 * A song is favoured when it belongs to a recent release on one of [pages],
 * the saved pages of the session's artists (`djReleaseArtists`). A page
 * gives a release's year and no date, so recent is the year of [now] and
 * the one before. A song belongs to a release when its album is that
 * release's page, or carries its title and the song credits the page's
 * artist. A song with no album, or on a release no page lists or dates,
 * keeps its score: an unknown release is neutral.
 */
export const djNewReleasesRanked = <S extends Pick<RankedRadioSong, "song" | "score">>(
  session: MagicSession,
  ranked: readonly S[],
  pages: readonly DjReleasePage[],
  now: number,
): S[] => finishSteps(djNewReleasesRankedSteps(session, ranked, pages, now));

/** `djNewReleasesRanked`, a step per song, for a background slice (#1448). */
export function* djNewReleasesRankedSteps<S extends Pick<RankedRadioSong, "song" | "score">>(
  session: MagicSession,
  ranked: readonly S[],
  pages: readonly DjReleasePage[],
  now: number,
): Generator<void, S[]> {
  if (session.dj?.newReleases !== true) return [...ranked];
  const year = new Date(now).getFullYear();
  const albumPages = new Set<string>();
  /** The recent releases' titles, by their artist. */
  const titles = new Map<string, Set<string>>();
  for (const page of pages) {
    const artist = catalogSeedKey(page.name);
    for (const release of [...page.albums, ...page.singles]) {
      if (release.year === null || release.year < year - 1 || release.year > year) continue;
      albumPages.add(release.browseId);
      if (artist === null) continue;
      const known = titles.get(artist) ?? new Set<string>();
      titles.set(artist, known.add(identityKey(release.title)));
    }
  }
  const recent = ({ song }: S): boolean => {
    if (song === null) return false;
    if (song.albumId !== null && albumPages.has(song.albumId)) return true;
    if (song.album === null) return false;
    const title = identityKey(song.album);
    return song.artists.some((name) => {
      const artist = catalogSeedKey(name);
      return artist !== null && titles.get(artist)?.has(title) === true;
    });
  };
  const raised = yield* mapSteps(
    ranked,
    (song): S => (recent(song) ? { ...song, score: song.score + DJ_NEW_RELEASE_BOOST } : song),
  );
  return yield* sortSteps(raised, (a, b) => b.score - a.score);
}
