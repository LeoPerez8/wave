import { artistPhotoName, ytArtistQuery } from "@wave/core";
import { makeExternalStore } from "../lib/externalStore.ts";

export interface LinkArtistName {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
}
export const ARTIST_NAME_PAGE_SIZE = 128;

/** No whole-artist query or finder: inspect small name pages only after a gesture. */
export const findLinkArtists = async (
  names: readonly string[],
  options: {
    readonly readPage: (after: LinkArtistName | null) => Promise<readonly LinkArtistName[]>;
    readonly signal: AbortSignal;
  },
): Promise<ReadonlyMap<string, LinkArtistName>> => {
  const wanted = new Set(names.filter((name) => ytArtistQuery(name) !== null).map(artistPhotoName));
  const found = new Map<string, LinkArtistName>();
  let after: LinkArtistName | null = null;
  while (!options.signal.aborted && wanted.size > 0) {
    const page = await options.readPage(after);
    if (options.signal.aborted) break;
    for (const artist of page) {
      const key = artistPhotoName(artist.name);
      if (wanted.delete(key)) found.set(key, artist);
    }
    const last = page.at(-1);
    if (last === undefined || wanted.size === 0 || page.length < ARTIST_NAME_PAGE_SIZE) break;
    after = last;
    // Let taps, the route and the deadline run between bounded synchronous reads.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return found;
};

/** The gesture adapter supplies the store reads; the same bounded path serves links and menus. */
export const readLinkArtists = async <A>(
  names: readonly string[],
  options: {
    readonly readPage: (after: LinkArtistName | null) => Promise<readonly LinkArtistName[]>;
    readonly readArtist: (id: number) => Promise<A | null>;
    readonly signal: AbortSignal;
  },
): Promise<ReadonlyMap<string, A | null>> => {
  const found = await findLinkArtists(names, options);
  const rows = new Map<string, A | null>();
  for (const name of names) {
    if (options.signal.aborted) break;
    const key = artistPhotoName(name);
    if (rows.has(key)) continue;
    const artist = found.get(key);
    rows.set(key, artist === undefined ? null : await options.readArtist(artist.id));
  }
  return rows;
};

/** A partial cache: unknown names stay unread, and only gestures start bounded reads. */
export const createArtistLinkLookup = <A>(options: {
  readonly version: () => number;
  readonly readPage: (
    after: LinkArtistName | null,
    signal: AbortSignal,
  ) => Promise<readonly LinkArtistName[]>;
  readonly readArtist: (id: number, signal: AbortSignal) => Promise<A | null>;
}) => {
  const known = makeExternalStore({ version: -1, artists: new Map<string, A | null>() });
  const find = (name: string): A | null | undefined => {
    const snapshot = known.get();
    return snapshot.version === options.version()
      ? snapshot.artists.get(artistPhotoName(name))
      : undefined;
  };
  return {
    get: known.get,
    subscribe: known.subscribe,
    find,
    read: async (
      names: readonly string[],
      signal: AbortSignal,
    ): Promise<(name: string) => A | null> => {
      const version = options.version();
      const snapshot = known.get();
      const artists = new Map(snapshot.version === version ? snapshot.artists : []);
      const missing = names.filter((name) => !artists.has(artistPhotoName(name)));
      if (missing.length > 0) {
        const found = await readLinkArtists(missing, {
          signal,
          readPage: (after) => options.readPage(after, signal),
          readArtist: (id) => options.readArtist(id, signal),
        });
        for (const [key, row] of found) artists.set(key, row);
        if (!signal.aborted && options.version() === version) {
          const latest = known.get();
          const merged = new Map(latest.version === version ? latest.artists : []);
          for (const [key, row] of found) merged.set(key, row);
          known.set({ version, artists: merged });
        }
      }
      return (name) => artists.get(artistPhotoName(name)) ?? null;
    },
  };
};
