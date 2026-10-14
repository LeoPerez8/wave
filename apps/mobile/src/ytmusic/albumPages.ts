import { WaveYtDownloads, type NativeYtAlbum } from "@/native/waveYtDownloads";

/** Album pages read this session, by browse id; a failed read is forgotten so it's asked again. */
const pages = new Map<string, Promise<NativeYtAlbum>>();

/**
 * The YT Music album page [browseId] (`MPREb_…`), read once per session: the
 * album screen, its long-press menu and each of its songs' downloads (their
 * tags) share one read, so a whole-album download lands as one album.
 */
export const readYtAlbum = (browseId: string): Promise<NativeYtAlbum> => {
  const known = pages.get(browseId);
  if (known !== undefined) return known;
  const page = WaveYtDownloads.album(browseId);
  pages.set(browseId, page);
  page.catch(() => {
    if (pages.get(browseId) === page) pages.delete(browseId);
  });
  return page;
};
