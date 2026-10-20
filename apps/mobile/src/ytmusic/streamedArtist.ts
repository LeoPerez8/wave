import {
  libraryArtistFinder,
  streamedArtistLink,
  type StreamedArtistLink,
  type StreamedArtistContext,
} from "@wave/core";
import { useMemo, useSyncExternalStore } from "react";

import { libraryVersion } from "@/library/LibraryScan";
import { LibraryStore, type ArtistRow } from "@/library/LibraryStore";
import {
  currentRouteNow,
  useCurrentPath,
  useCurrentRoute,
  type CurrentRoute,
} from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { makeVersionedCache } from "@/lib/versionedCache";
import { useYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";

import { ytArtistPageHere } from "./routes";

// oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
const listArtists = LibraryStore.use((store) => store.listArtists);

/**
 * Which Library artist a name is (Core's `libraryArtistFinder`), built from
 * the Library's artists once per `libraryVersion` and only while a streamed
 * song's artist link is shown. Null until first read.
 */
const sharedArtists = makeVersionedCache<((name: string) => ArtistRow | null) | null>({
  version: libraryVersion,
  initial: null,
  build: () => appRuntime.runPromise(listArtists).then(libraryArtistFinder),
});

const idle = () => () => {};

/** How long a menu waits for the Library's artists before it opens without them. */
const ARTISTS_WAIT_MS = 500;

/** The wait under way for the Library's artists, shared by whoever asks meanwhile. */
let reading: Promise<void> | null = null;

/**
 * Resolves once the Library's artists have been read (at once when they
 * have), so a menu offering Go to Artist opens with it. A failed read (tried
 * again by this wait) resolves as soon as it fails; a slow one after a short
 * wait.
 */
export const libraryArtistsRead = (): Promise<void> => {
  if (sharedArtists.get() !== null) return Promise.resolve();
  // One wait at a time, however many rows (each a swipe set to Go to Artist) ask.
  reading ??= new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      stop();
      reading = null;
      resolve();
    };
    const timer = setTimeout(done, ARTISTS_WAIT_MS);
    // Told once the read settles, read or failed.
    const stop = sharedArtists.subscribe(done);
  });
  return reading;
};

/**
 * Where the link to a streamed song's [artists] leads (Core's
 * `streamedArtistLink`): undefined with YT Music off, for no artist, or
 * until the Library's artists are read, so a Library artist never opens as
 * YouTube Music's. It follows the Library only while [active].
 */
export const useStreamedArtistLink = (
  artists: readonly string[] | null,
  active = true,
): StreamedArtistLink<ArtistRow> | undefined => {
  const context = useStreamedArtistContext(active);
  return useMemo(
    () =>
      artists === null || context === undefined ? undefined : streamedArtistLink(artists, context),
    [artists, context],
  );
};

const ytArtistOf = ({ pathname, params }: CurrentRoute): string | null =>
  ytArtistPageHere(pathname, params);

/** Shared artist resolution for a streamed song's menu and mixed selection. */
export const useStreamedArtistContext = (
  active = true,
): StreamedArtistContext<ArtistRow> | undefined => {
  const libraryArtist = useSyncExternalStore(
    active ? sharedArtists.subscribe : idle,
    sharedArtists.get,
  );
  const enabled = useYtMusicEnabled();
  // The route is followed only while [active]; inactive, it's read as the caller renders.
  const here = useCurrentPath(active);
  // On a YouTube Music artist page, the link leaves that artist out.
  const ytArtistHere = useCurrentRoute(ytArtistOf, active);
  return useMemo(
    () => (libraryArtist === null ? undefined : { libraryArtist, enabled, here, ytArtistHere }),
    [libraryArtist, enabled, here, ytArtistHere],
  );
};

/**
 * The artist resolution a streamed song's menu would use, as things are now,
 * unfollowed: for a row's swipe, which follows nothing. Undefined until the
 * Library's artists are read (`libraryArtistsRead`).
 */
export const streamedArtistContextNow = (): StreamedArtistContext<ArtistRow> | undefined => {
  const libraryArtist = sharedArtists.get();
  if (libraryArtist === null) return undefined;
  const route = currentRouteNow();
  return {
    libraryArtist,
    enabled: ytMusicEnabled(),
    here: route.pathname,
    ytArtistHere: ytArtistOf(route),
  };
};
