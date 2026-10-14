import { streamedArtistLink, type StreamedArtistLink } from "@wave/core";
import { usePathname } from "expo-router";
import { useMemo, useSyncExternalStore } from "react";

import { libraryVersion } from "@/library/LibraryScan";
import { LibraryStore, type ArtistRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { makeVersionedCache } from "@/lib/versionedCache";
import { useYtMusicEnabled } from "@/settings/ytMusic";

const listArtists = LibraryStore.use((store) => store.listArtists);

/**
 * The Library's artists, read once per `libraryVersion` and only while a
 * streamed song's artist link is shown. Null until first read.
 */
const sharedArtists = makeVersionedCache<readonly ArtistRow[] | null>({
  version: libraryVersion,
  initial: null,
  build: () => appRuntime.runPromise(listArtists),
});

const idle = () => () => {};

/** How long a menu waits for the Library's artists before it opens without them. */
const ARTISTS_WAIT_MS = 500;

/**
 * Resolves once the Library's artists have been read (at once when they
 * have), so a menu offering Go to Artist opens whole and never grows; after
 * a short wait it resolves anyway.
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
    const stop = sharedArtists.subscribe(() => {
      if (sharedArtists.get() !== null) done();
    });
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
  const libraryArtists = useSyncExternalStore(
    active ? sharedArtists.subscribe : idle,
    sharedArtists.get,
  );
  const enabled = useYtMusicEnabled();
  const here = usePathname();
  return useMemo(
    () =>
      artists === null || libraryArtists === null
        ? undefined
        : streamedArtistLink(artists, { libraryArtists, enabled, here }),
    [artists, libraryArtists, enabled, here],
  );
};
