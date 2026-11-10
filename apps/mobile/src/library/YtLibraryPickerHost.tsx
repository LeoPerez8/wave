/**
 * Opening Library › Playlists › Import Playlists › From YT Music's and From
 * Spotify's picker, and Export to YT Music's, and their host at the root.
 */
import { ytExportSignInAlert } from "@wave/core";
import { useCallback, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { currentLocalisation } from "@/localisation/localisation";
import { confirmAction } from "@/overlay/alert";
import { signInToSpotify, spotifySignedIn } from "@/settings/spotifyAccount";
import { signInToYtMusic, ytMusicSignedIn } from "@/settings/ytAccount";

import { ExportSheet } from "./YtExportPicker";
import { PickerSheet } from "./YtLibraryPicker";

/** Whose library a picker lists. */
export type LibraryService = "ytMusic" | "spotify";

/** The picker that is up, if any (`YtLibraryPickerHost` draws it): an import's, or Export's. */
const shown = makeExternalStore<
  | { readonly service: LibraryService; readonly onClosed?: (imported: boolean) => void }
  | "export"
  | null
>(null);

/**
 * From YT Music: the picker, once signed in. Signed out (or the session
 * expired), the sign-in opens first; leaving it opens nothing.
 */
export const openYtLibraryImport = async (
  onClosed?: (imported: boolean) => void,
): Promise<void> => {
  if ((await ytMusicSignedIn()) || (await signInToYtMusic()))
    shown.set({ service: "ytMusic", onClosed });
  else onClosed?.(false);
};

/**
 * From Spotify: the picker, once signed in to Spotify. Signed out (or the
 * session expired), Spotify's sign-in opens first; leaving it opens nothing.
 */
export const openSpotifyLibraryImport = async (
  onClosed?: (imported: boolean) => void,
): Promise<void> => {
  if ((await spotifySignedIn()) || (await signInToSpotify()))
    shown.set({ service: "spotify", onClosed });
  else onClosed?.(false);
};

/**
 * Export to YT Music: its picker, once signed in to YouTube Music. Signed
 * out (or the session expired), it asks first as Share does (Core's
 * `ytExportSignInAlert`), then the sign-in opens; declining either opens
 * nothing.
 */
export const openYtExport = async (): Promise<void> => {
  if (
    (await ytMusicSignedIn()) ||
    ((await confirmAction(ytExportSignInAlert(currentLocalisation().strings))) &&
      (await signInToYtMusic()))
  )
    shown.set("export");
};

/** Draws the picker while it's up; mounted once at the root. */
export function YtLibraryPickerHost() {
  const open = useSyncExternalStore(shown.subscribe, shown.get);
  const close = useCallback(
    (imported = false) => {
      shown.set(null);
      if (open !== null && open !== "export") open.onClosed?.(imported);
    },
    [open],
  );
  if (open === null) return null;
  if (open === "export") return <ExportSheet onClosed={close} />;
  return <PickerSheet key={open.service} service={open.service} onClosed={close} />;
}
