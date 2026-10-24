/** Already stored artist profiles; recommendation reads never request genre data. */
import {
  artistProfilesKnown,
  libraryGenreProfiles,
  parseArtistProfiles,
  storedArtistProfiles,
  type ArtistProfiles,
  type GenreProfileLibrary,
  type GenreProfileOf,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/** The profiles looked up so far, kept on this phone (not synced). */
const profiles = persistedSetting<ArtistProfiles>({
  key: "home.mixArtistProfiles",
  read: parseArtistProfiles,
  write: (value) => (value.size === 0 ? null : storedArtistProfiles(value)),
  persistDelayMs: 2000,
});

/** An outside artist's profile as looked up so far: undefined when never looked up. */
export const lookedUpProfileOf: GenreProfileOf = (artist) =>
  artistProfilesKnown(profiles.get())(artist);

/** Known Library profiles, falling back to profiles already stored on the phone. */
export const magicProfileOf = (library: GenreProfileLibrary): GenreProfileOf => {
  const ofLibrary = libraryGenreProfiles(library);
  return (artist) => ofLibrary(artist) ?? lookedUpProfileOf(artist);
};
