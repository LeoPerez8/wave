import { knownPages } from "@wave/core";

import { WaveYtDownloads, type NativeYtAlbum } from "@/native/waveYtDownloads";

/**
 * How many YT Music album pages are kept (Performance rules, 12): a page holds
 * a few dozen songs' rows, and an album's downloads finish long before this
 * many other albums are opened.
 */
export const YT_ALBUM_PAGES_KEPT = 24;

/** Album pages read this session, by browse id; a failed read is forgotten so it's asked again. */
const pages = knownPages<Promise<NativeYtAlbum>>(YT_ALBUM_PAGES_KEPT);

/**
 * The YT Music album page [browseId] (`MPREb_…`), read once while kept: the
 * album screen, its long-press menu and each of its songs' downloads (their
 * tags) share one read, so a whole-album download lands as one album.
 */
export const readYtAlbum = (browseId: string): Promise<NativeYtAlbum> => {
  const known = pages.get(browseId);
  if (known !== undefined) return known;
  const page = WaveYtDownloads.album(browseId);
  pages.set(browseId, page);
  page.catch(() => {
    if (pages.get(browseId) === page) pages.forget(browseId);
  });
  return page;
};
