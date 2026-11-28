/** Already stored artist profiles; recommendation reads never request genre data. */
import {
  artistProfileDue,
  artistProfilesKnown,
  libraryGenreProfiles,
  libraryGenreProfilesSteps,
  parseArtistProfiles,
  storedArtistProfiles,
  withArtistProfiles,
  type GenreProfile,
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
  // Each write stores every profile (up to 2,000) at once, and the lookup saves one about every
  // 2.5 s: they're written once it pauses, or once a minute while it runs (#1530). Wave going
  // to the background writes what waits at once (`persistedSetting`).
  persistDelayMs: 10_000,
  persistMaxDelayMs: 60_000,
});

/** An outside artist's profile as looked up so far: undefined when never looked up. */
export const lookedUpProfileOf: GenreProfileOf = (artist) =>
  artistProfilesKnown(profiles.get(), { legacyOnly: true })(artist);

export const knownGenreMixProfiles = (): GenreProfileOf => artistProfilesKnown(profiles.get());

export const genreMixArtistDue = (artist: string): boolean =>
  artistProfileDue(profiles.get(), artist, Date.now());

export const saveGenreMixArtistProfile = (artist: string, profile: GenreProfile | null): void =>
  profiles.set(withArtistProfiles(profiles.get(), [[artist, profile, Date.now()]]));

/** Known Library profiles, falling back to profiles already stored on the phone. */
export const magicProfileOf = (library: GenreProfileLibrary): GenreProfileOf => {
  const ofLibrary = libraryGenreProfiles(library);
  return (artist) => ofLibrary(artist) ?? lookedUpProfileOf(artist);
};

/** `magicProfileOf`, a song or an artist per step, for a Magic Queue batch's slices (#1448). */
export function* magicProfileOfSteps(
  library: GenreProfileLibrary,
): Generator<void, GenreProfileOf> {
  const ofLibrary = yield* libraryGenreProfilesSteps(library);
  return (artist) => ofLibrary(artist) ?? lookedUpProfileOf(artist);
}
