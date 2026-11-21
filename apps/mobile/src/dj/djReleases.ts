/**
 * The pages DJ's New releases filter ranks with (docs/spec.md, DJ): what the
 * phone has saved for the pages of a session's artists (Core's
 * `djReleaseArtists`). Nothing is asked of YouTube Music for them.
 */
import {
  djReleaseArtists,
  type ArtistGraph,
  type DjReleasePage,
  type MagicSession,
  type YtArtistSaved,
} from "@wave/core";

const releases = (list: unknown): DjReleasePage["albums"] =>
  Array.isArray(list) ? (list as DjReleasePage["albums"]) : [];

/**
 * Reads the saved pages of a session's artists with [saved] (what's saved
 * for an artist's page, or null), keeping their albums and singles only. An
 * artist with no page saved, or whose read fails, brings none, so it never
 * rejects. With New releases off, or in a queue that isn't DJ's, nothing is
 * read. The last session's pages are kept, so its later batches read none
 * again while its artists stay the same.
 */
export const djReleasePagesReader = (saved: (name: string) => Promise<YtArtistSaved | null>) => {
  let last: { readonly key: string; readonly pages: readonly DjReleasePage[] } | null = null;
  return async (
    session: MagicSession,
    graph: ArtistGraph | null,
  ): Promise<readonly DjReleasePage[]> => {
    const names = djReleaseArtists(session, graph);
    if (names.length === 0) return [];
    const key = [session.id, ...names].join("\n");
    if (last?.key === key) return last.pages;
    const answers = await Promise.all(names.map((name) => saved(name).catch(() => null)));
    const pages = answers.flatMap((answer) =>
      answer?.outcome === "found"
        ? [
            {
              name: answer.page.name,
              albums: releases(answer.page.albums),
              singles: releases(answer.page.singles),
            },
          ]
        : [],
    );
    last = { key, pages };
    return pages;
  };
};
