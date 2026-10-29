import type { FollowedArtist } from "@wave/core";
import * as Effect from "effect/Effect";

import { openYtArtist, openYtArtistNamed } from "@/ytmusic/routes";

import { findLinkArtists } from "./artistLookup";
import { LibraryStore } from "./LibraryStore";
import { openArtist } from "./routes";
import { appRuntime } from "./runtime";

/** A followed artist's page: the Library's when it has them, else their YT Music page. */
export const openFollowedArtist = async (artist: FollowedArtist): Promise<void> => {
  const found = await findLinkArtists([artist.name], {
    signal: new AbortController().signal,
    readPage: (after) =>
      appRuntime.runPromise(
        Effect.flatMap(LibraryStore, (store) => store.artistNamesForLink(after)),
      ),
  });
  const library = found.get(artist.key);
  if (library !== undefined) openArtist(library.id);
  else if (artist.ytBrowseId !== null) openYtArtist(artist.ytBrowseId, artist.name);
  else openYtArtistNamed(artist.name);
};
