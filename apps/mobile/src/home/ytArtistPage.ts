/**
 * Finding an artist's YouTube Music page by name, for the radios Home's mixes
 * and the Magic Queue grow from: the match their artist page saved, else the
 * one an Artists search finds (Core's `ytArtistLookup`, `pickYtArtist`); and
 * starting their radio, from where it started last time when that's
 * remembered (`artistRadio`).
 */
import {
  identityKey,
  parseArtistRadioStarts,
  pickYtArtist,
  storedArtistRadioStarts,
  ytArtistLookup,
  type ArtistRadioStarts,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { persistedSetting } from "@/lib/persistedSetting";
import { LibraryStore } from "@/library/LibraryStore";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";

import { artistRadioReader } from "./artistRadio";

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
const ytArtistBrowseId = (name: string) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const lookup = ytArtistLookup(name, yield* savedYtArtist(name));
    if (lookup === null) return null;
    if (lookup.kind === "page") return lookup.browseId;
    const { query } = lookup;
    const artists = yield* withSearchTurn("discover", query, ytMusic.searchArtists(query));
    return pickYtArtist(name, artists);
  });

/** Where artists' radios start, remembered on this phone (not synced). */
const radioStarts = persistedSetting<ArtistRadioStarts>({
  key: "home.artistRadioStarts",
  read: parseArtistRadioStarts,
  write: storedArtistRadioStarts,
  persistDelayMs: 2000,
});

const radioOfPage = artistRadioReader({
  starts: radioStarts,
  fromStart: (start) => Effect.flatMap(Effect.service(YtMusic), (yt) => yt.radio({ start })),
  fromPage: (browseId) => Effect.flatMap(Effect.service(YtMusic), (yt) => yt.artistRadio(browseId)),
});

/**
 * The first page of [artist]'s radio, as their YT Music page's Start radio
 * starts it ([browseId], else the page their name finds): from where it
 * started last time when that's remembered, without reading the page
 * (`artistRadioReader`). Null when YouTube Music doesn't have the artist;
 * fails when the radio can't be started.
 */
export const artistRadio = (artist: { readonly name: string; readonly browseId?: string }) =>
  Effect.gen(function* () {
    const browseId = artist.browseId ?? (yield* ytArtistBrowseId(artist.name));
    if (browseId === null) return null;
    return yield* radioOfPage(browseId);
  });
