import { libraryArtistFinder, streamedArtistLink, type StreamedArtistLink } from "@wave/core";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { useMemo, useSyncExternalStore } from "react";

import { libraryVersion } from "@/library/LibraryScan";
import { LibraryStore, type ArtistRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { makeVersionedCache } from "@/lib/versionedCache";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { ytArtistPageHere } from "./routes";

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

/**
 * Resolves once the Library's artists have been read (at once when they
 * have), so a menu offering Go to Artist opens with it. A failed read (tried
 * again by this wait) resolves as soon as it fails; a slow one after a short
 * wait.
 */
export const libraryArtistsRead = (): Promise<void> => {
  if (sharedArtists.get() !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, ARTISTS_WAIT_MS);
    // Told once the read settles, read or failed.
    const stop = sharedArtists.subscribe(done);
  });
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
  const libraryArtist = useSyncExternalStore(
    active ? sharedArtists.subscribe : idle,
    sharedArtists.get,
  );
  const enabled = useYtMusicEnabled();
  const here = usePathname();
  const params = useGlobalSearchParams<{ name?: string }>();
  // On a YouTube Music artist page, the link leaves that artist out.
  const ytArtistHere = ytArtistPageHere(here, params);
  return useMemo(
    () =>
      artists === null || libraryArtist === null
        ? undefined
        : streamedArtistLink(artists, { libraryArtist, enabled, here, ytArtistHere }),
    [artists, libraryArtist, enabled, here, ytArtistHere],
  );
};
