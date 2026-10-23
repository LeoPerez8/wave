import {
  artistPhotoName,
  resolveStreamedArtistLink,
  streamedArtistLink,
  type StreamedArtistLink,
  type StreamedArtistContext,
} from "@wave/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { libraryVersion } from "@/library/LibraryScan";
import { createArtistLinkLookup } from "@/library/artistLookup";
import { LibraryStore, type ArtistRow } from "@/library/LibraryStore";
import {
  currentRouteNow,
  useCurrentPath,
  useCurrentRoute,
  type CurrentRoute,
} from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { online } from "@/native/waveNative";
import { useYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";

import { ytArtistPageHere } from "./routes";

const known = createArtistLinkLookup({
  version: libraryVersion.get,
  readPage: (after, signal) =>
    appRuntime.runPromise(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect service access.
      LibraryStore.use((store) => store.artistNamesForLink(after)),
      { signal },
    ),
  readArtist: async (id, signal) =>
    (
      await appRuntime.runPromise(
        // oxlint-disable-next-line react/rules-of-hooks -- Effect service access.
        LibraryStore.use((store) => store.linkRows({ artistId: id })),
        { signal },
      )
    ).artist,
});
const idle = () => () => {};
const ytArtistOf = ({ pathname, params }: CurrentRoute): string | null =>
  ytArtistPageHere(pathname, params);

/** Resolve against the tap's route, never a later route hidden under the closing sheet. */
export const resolveStreamedArtistTap = (link: StreamedArtistLink<ArtistRow>) =>
  resolveStreamedArtistLink(link, streamedArtistContextNow(), {
    online: online(),
    read: known.read,
  });

/** Explicit menu/swipe preparation; no render starts a whole-Library read. */
export const libraryArtistsRead = async (
  names: readonly string[],
  version = libraryVersion.get(),
): Promise<void> => {
  if (names.length === 0 || version !== libraryVersion.get()) return;
  const context = streamedArtistContextNow();
  const link = streamedArtistLink(names, { ...context, libraryArtist: null });
  if (link !== undefined)
    await resolveStreamedArtistLink(link, context, { online: online(), read: known.read });
};

export const useStreamedArtistLink = (
  artists: readonly string[] | null,
  active = true,
): StreamedArtistLink<ArtistRow> | undefined => {
  const context = useStreamedArtistContext(active);
  return useMemo(
    () => (artists === null ? undefined : streamedArtistLink(artists, context)),
    [artists, context],
  );
};

/** Only shown surfaces follow the route; cached, requested names cost no read on opening. */
export const useStreamedArtistContext = (
  active = true,
  names?: readonly string[],
): StreamedArtistContext<ArtistRow> => {
  const snapshot = useSyncExternalStore(active ? known.subscribe : idle, known.get);
  const version = useSyncExternalStore(
    active ? libraryVersion.subscribe : idle,
    libraryVersion.get,
  );
  const enabled = useYtMusicEnabled();
  const here = useCurrentPath(active);
  const ytArtistHere = useCurrentRoute(ytArtistOf, active);
  // Mixed selection needs name/id equivalence. This bounded read belongs to that explicit card.
  const key = names === undefined ? null : JSON.stringify(names);
  useEffect(() => {
    if (active && key !== null) void libraryArtistsRead(JSON.parse(key) as string[], version);
  }, [active, key, version]);
  return useMemo(
    () => ({
      libraryArtist:
        snapshot.version !== version || snapshot.artists.size === 0
          ? null
          : (name: string) => snapshot.artists.get(artistPhotoName(name)),
      enabled,
      here,
      ytArtistHere,
    }),
    [snapshot, version, enabled, here, ytArtistHere],
  );
};

/** A row reads route/cache snapshots without a route subscription. */
export const streamedArtistContextNow = (): StreamedArtistContext<ArtistRow> => {
  const snapshot = known.get();
  const route = currentRouteNow();
  return {
    // Unknown names stay unread even if a previous tap resolved a different artist.
    libraryArtist:
      snapshot.version === libraryVersion.get() && snapshot.artists.size > 0
        ? (name: string) => snapshot.artists.get(artistPhotoName(name))
        : null,
    enabled: ytMusicEnabled(),
    here: route.pathname,
    ytArtistHere: ytArtistOf(route),
  };
};
