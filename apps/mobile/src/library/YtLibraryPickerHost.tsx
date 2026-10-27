/**
 * Opening Library › Playlists › Import Playlists › From YT Music's and From
 * Spotify's picker, and its host at the root. The picker itself
 * (`YtLibraryPicker`) loads the first time it opens.
 */
import { useCallback, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { signInToSpotify, spotifySignedIn } from "@/settings/spotifyAccount";
import { signInToYtMusic, ytMusicSignedIn } from "@/settings/ytAccount";

import { PickerSheet } from "./YtLibraryPicker";

/** Whose library a picker lists. */
export type LibraryService = "ytMusic" | "spotify";

/** The picker that is up, if any (`YtLibraryPickerHost` draws it). */
const shown = makeExternalStore<LibraryService | null>(null);

/**
 * From YT Music: the picker, once signed in. Signed out (or the session
 * expired), the sign-in opens first; leaving it opens nothing.
 */
export const openYtLibraryImport = async (): Promise<void> => {
  if ((await ytMusicSignedIn()) || (await signInToYtMusic())) shown.set("ytMusic");
};

/**
 * From Spotify: the picker, once signed in to Spotify. Signed out (or the
 * session expired), Spotify's sign-in opens first; leaving it opens nothing.
 */
export const openSpotifyLibraryImport = async (): Promise<void> => {
  if ((await spotifySignedIn()) || (await signInToSpotify())) shown.set("spotify");
};

/** Draws the picker while it's up; mounted once at the root. */
export function YtLibraryPickerHost() {
  const open = useSyncExternalStore(shown.subscribe, shown.get);
  const close = useCallback(() => shown.set(null), []);
  return open === null ? null : <PickerSheet key={open} service={open} onClosed={close} />;
}
