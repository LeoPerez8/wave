/**
 * Finding an artist's YouTube Music page by name, for the radios Home's mixes
 * and the Magic Queue grow from: the match their artist page saved, else the
 * one an Artists search finds (Core's `ytArtistLookup`, `pickYtArtist`).
 */
import { identityKey, pickYtArtist, ytArtistLookup } from "@wave/core";
import * as Effect from "effect/Effect";

import { LibraryStore } from "@/library/LibraryStore";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";

/** What was saved for a Library artist's YT Music section, or null. */
export const savedYtArtist = (name: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return yield* store.ytArtist(identityKey(name)).pipe(Effect.orElseSucceed(() => null));
  });

/**
 * The browse id of the YT Music artist page [name] is: the match their
 * artist page saved, or the one an Artists search finds. Null when YouTube
 * Music has no such artist; fails when the search can't be made.
 */
export const ytArtistBrowseId = (name: string) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const lookup = ytArtistLookup(name, yield* savedYtArtist(name));
    if (lookup === null) return null;
    if (lookup.kind === "page") return lookup.browseId;
    const { query } = lookup;
    const artists = yield* withSearchTurn("discover", query, ytMusic.searchArtists(query));
    return pickYtArtist(name, artists);
  });
