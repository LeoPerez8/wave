/**
 * Go to Artist from a streamed song (docs/spec.md, "YT Music"): a YT Music
 * song isn't the Library's, so its artists are names. Core decides which
 * artist page each name opens, the Library artist's or the YouTube Music
 * artist page, and whether the song's credit is one artist or a choice.
 */

import { artistPhotoName } from "./artistPhoto.ts";
import { isDetailPath } from "./navigation.ts";
import { ytArtistQuery } from "./ytArtist.ts";

/** Where one of a streamed song's artists leads. */
export type StreamedArtistTarget<A> =
  /** The Library has the artist: their Library page, opened integrated. */
  | { readonly kind: "library"; readonly artist: A }
  /** Anyone else: the YouTube Music artist page, found by [name]. */
  | { readonly kind: "yt"; readonly name: string };

/** Where a streamed song's artist link leads: straight to the one artist, or a choice of several. */
export type StreamedArtistLink<A> =
  | { readonly kind: "open"; readonly target: StreamedArtistTarget<A> }
  | { readonly kind: "choose"; readonly targets: readonly StreamedArtistTarget<A>[] };

export interface StreamedArtistContext<A> {
  /**
   * The Library artist a name is, or null (Core's `libraryArtistFinder`,
   * built once per Library): which of the names the Library has.
   */
  readonly libraryArtist: (name: string) => A | null;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  /** The current route, so the link doesn't lead to the page you're on. */
  readonly here: string;
}

/**
 * Where the link to a streamed song's [artists] (as YouTube Music credits
 * them) leads, the artist opening integrated: each name the Library has
 * (`libraryArtist`, as artist photos compare names) is their
 * Library page, any other the YouTube Music artist page. One artist opens
 * straight away, several are a choice in credit order. Names that aren't an
 * artist's ("Unknown Artist", `ytArtistQuery`), a name credited twice and the
 * Library artist page you're on are left out. Undefined when nobody is left,
 * or with YT Music off.
 */
export const streamedArtistLink = <A extends { readonly id: number; readonly name: string }>(
  artists: readonly string[],
  context: StreamedArtistContext<A>,
): StreamedArtistLink<A> | undefined => {
  if (!context.enabled) return undefined;
  const targets: StreamedArtistTarget<A>[] = [];
  const seen = new Set<string>();
  for (const name of artists) {
    if (ytArtistQuery(name) === null) continue;
    const artist = context.libraryArtist(name);
    if (artist !== null && isDetailPath(context.here, "artist", artist.id)) continue;
    const key = artist === null ? `yt:${artistPhotoName(name)}` : `library:${artist.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(artist === null ? { kind: "yt", name } : { kind: "library", artist });
  }
  const [first] = targets;
  if (first === undefined) return undefined;
  return targets.length === 1 ? { kind: "open", target: first } : { kind: "choose", targets };
};
