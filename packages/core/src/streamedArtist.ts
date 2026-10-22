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
  | { readonly kind: "yt"; readonly name: string; readonly offline?: true }
  /** The line is live; resolve Library membership on the tap. */
  | { readonly kind: "unread"; readonly name: string };

/**
 * Where a streamed song's artist link leads: straight to the one artist, a
 * choice of several, or nowhere new because its only artist is the page
 * you're on (Now Playing's line still closes to reveal it; menus offer no
 * Go to Artist).
 */
export type StreamedArtistLink<A> =
  | { readonly kind: "open"; readonly target: StreamedArtistTarget<A> }
  | { readonly kind: "choose"; readonly targets: readonly StreamedArtistTarget<A>[] }
  | { readonly kind: "here" };

export interface StreamedArtistContext<A> {
  /**
   * The Library artist a name is, null for a known absence, undefined for
   * an unread name. A null finder means no names have been read yet.
   */
  readonly libraryArtist: ((name: string) => A | null | undefined) | null;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  /** The current route, so the link doesn't lead to the Library artist page you're on. */
  readonly here: string;
  /**
   * The name of the YouTube Music artist page you're on (opened by browse id
   * or by name, the name it was opened with), so the link doesn't stack it
   * again. Undefined or null elsewhere.
   */
  readonly ytArtistHere?: string | null;
}

/** Who [name] is, the Library's [artist] when it has them: one key per artist. */
const artistKey = (name: string, artist: { readonly id: number } | null): string =>
  artist === null ? `yt:${artistPhotoName(name)}` : `library:${artist.id}`;

/**
 * The artists a streamed song credited to [artists] is by, as keys a Library
 * song's artist ids compare with (`libraryArtistKey`): the Library's artist
 * for a name it has, else the name. Names that aren't an artist's are left out.
 */
export const streamedArtistKeys = <A extends { readonly id: number }>(
  artists: readonly string[],
  libraryArtist: ((name: string) => A | null | undefined) | null,
): string[] =>
  artists.flatMap((name) =>
    ytArtistQuery(name) === null ? [] : [artistKey(name, libraryArtist?.(name) ?? null)],
  );

/** A Library artist's key, as `streamedArtistKeys` gives it. */
export const libraryArtistKey = (artistId: number): string => artistKey("", { id: artistId });

/**
 * Where the link to a streamed song's [artists] (as YouTube Music credits
 * them) leads, the artist opening integrated: each name the Library has
 * (`libraryArtist`, as artist photos compare names) is their
 * Library page, any other the YouTube Music artist page. One artist opens
 * straight away, several are a choice in credit order. Names that aren't an
 * artist's ("Unknown Artist", `ytArtistQuery`), a name credited twice and the
 * artist page you're on, the Library's or YouTube Music's, are left out: when
 * that page is all that's left, the link is `here`. Undefined when nobody is
 * left, or with YT Music off.
 */
export const streamedArtistLink = <A extends { readonly id: number; readonly name: string }>(
  artists: readonly string[],
  context: StreamedArtistContext<A>,
): StreamedArtistLink<A> | undefined => {
  if (!context.enabled) return undefined;
  const targets: StreamedArtistTarget<A>[] = [];
  const seen = new Set<string>();
  const ytPage = context.ytArtistHere ?? null;
  const ytHere = ytPage === null ? null : `yt:${artistPhotoName(ytPage)}`;
  let here = false;
  for (const name of artists) {
    if (ytArtistQuery(name) === null) continue;
    const matched = context.libraryArtist?.(name);
    const artist = matched ?? null;
    const key = artistKey(name, artist);
    if (key === ytHere || (artist !== null && isDetailPath(context.here, "artist", artist.id))) {
      here = true;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(
      artist !== null
        ? { kind: "library", artist }
        : { kind: matched === undefined ? "unread" : "yt", name },
    );
  }
  const [first] = targets;
  if (first === undefined) return here ? { kind: "here" } : undefined;
  return targets.length === 1 ? { kind: "open", target: first } : { kind: "choose", targets };
};

/** The same short deadline used by menus, independent of sheet animation. */
export const STREAMED_ARTIST_WAIT_MS = 500;
const noLibraryArtist = (): null => null;

/** Resolve unread names only on a gesture. Failure/timeout always has a YT destination. */
export const resolveStreamedArtistLink = async <
  A extends { readonly id: number; readonly name: string },
>(
  link: StreamedArtistLink<A>,
  context: StreamedArtistContext<A>,
  options: {
    readonly online: boolean;
    readonly read: (
      names: readonly string[],
      signal: AbortSignal,
    ) => Promise<(name: string) => A | null>;
    readonly waitMs?: number;
  },
): Promise<StreamedArtistLink<A> | undefined> => {
  const targets = link.kind === "open" ? [link.target] : link.kind === "choose" ? link.targets : [];
  let resolved = link;
  if (targets.some((target) => target.kind === "unread")) {
    const names = targets.map((target) =>
      target.kind === "library" ? target.artist.name : target.name,
    );
    const unread = targets.flatMap((target) => (target.kind === "unread" ? [target.name] : []));
    const known = new Map(
      targets.flatMap((target): [string, A | null][] =>
        target.kind === "unread"
          ? []
          : [
              [
                artistPhotoName(target.kind === "library" ? target.artist.name : target.name),
                target.kind === "library" ? target.artist : null,
              ],
            ],
      ),
    );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const find = await Promise.race([
        Promise.resolve()
          .then(() => options.read(unread, controller.signal))
          .catch(() => noLibraryArtist),
        new Promise<typeof noLibraryArtist>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(noLibraryArtist);
          }, options.waitMs ?? STREAMED_ARTIST_WAIT_MS);
        }),
      ]);
      const next = streamedArtistLink(names, {
        ...context,
        libraryArtist: (name) =>
          known.has(artistPhotoName(name)) ? known.get(artistPhotoName(name))! : find(name),
      });
      if (next === undefined) return undefined;
      resolved = next;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  const offline = (target: StreamedArtistTarget<A>): StreamedArtistTarget<A> =>
    target.kind === "yt" && !options.online ? { ...target, offline: true } : target;
  return resolved.kind === "open"
    ? { ...resolved, target: offline(resolved.target) }
    : resolved.kind === "choose"
      ? { ...resolved, targets: resolved.targets.map(offline) }
      : resolved;
};
