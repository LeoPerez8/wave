import { followArtistKey } from "./followedArtists.ts";
import { deezerArtistCandidates } from "./artistPhoto.ts";

export interface DeezerFollowArtist {
  readonly name: string;
  readonly deezerId: number;
  readonly imageUrl: string | null;
  readonly fans: number;
}

/** null means no answer; an empty list is a successful search with no matches. */
export const deezerFollowArtists = (response: unknown): DeezerFollowArtist[] | null => {
  if (
    typeof response !== "object" ||
    response === null ||
    !("data" in response) ||
    !Array.isArray(response.data)
  )
    return null;
  return response.data.flatMap((row: unknown) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("id" in row) ||
      typeof row.id !== "number" ||
      !Number.isSafeInteger(row.id) ||
      row.id <= 0
    )
      return [];
    if ("type" in row && row.type !== "artist") return [];
    const artist = deezerArtistCandidates({ data: [row] })?.[0];
    if (artist === undefined || artist.name.trim() === "") return [];
    return [
      {
        name: artist.name,
        deezerId: row.id,
        imageUrl: artist.thumbUrl ?? artist.largeUrl,
        fans: artist.fans,
      },
    ];
  });
};

export interface FollowArtistSearchResult<A> {
  readonly key: string;
  readonly name: string;
  readonly library: A | null;
  readonly deezerId: number | null;
  readonly imageUrl: string | null;
}

/** Library matches keep their order and images. Namesakes share the most followed identity. */
export const mergeFollowArtistSearch = <A extends { readonly name: string }>(
  library: readonly A[],
  matches: readonly A[],
  online: readonly DeezerFollowArtist[],
): FollowArtistSearchResult<A>[] => {
  const locals = new Map(library.map((artist) => [followArtistKey(artist.name), artist]));
  const remote = new Map<string, DeezerFollowArtist>();
  for (const artist of online) {
    const key = followArtistKey(artist.name);
    const before = remote.get(key);
    if (before === undefined || artist.fans > before.fans) remote.set(key, artist);
  }
  const results = new Map<string, FollowArtistSearchResult<A>>();
  const add = (name: string) => {
    const key = followArtistKey(name);
    if (results.has(key)) return;
    const local = locals.get(key) ?? null;
    const artist = remote.get(key);
    results.set(key, {
      key,
      name: local?.name ?? name,
      library: local,
      deezerId: artist?.deezerId ?? null,
      imageUrl: local === null ? (artist?.imageUrl ?? null) : null,
    });
  };
  for (const artist of matches) add(artist.name);
  for (const artist of remote.values()) add(artist.name);
  return [...results.values()];
};
