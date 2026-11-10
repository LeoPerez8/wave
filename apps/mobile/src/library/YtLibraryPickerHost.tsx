/**
 * Opening Library › Playlists › Import Playlists › From YT Music's and From
 * Spotify's picker, and Export to YT Music's, and their host at the root.
 */
import { ytExportSignInAlert } from "@wave/core";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { currentLocalisation } from "@/localisation/localisation";
import { confirmAction } from "@/overlay/alert";
import { signInToSpotify, spotifySignedIn } from "@/settings/spotifyAccount";
import { signInToYtMusic, ytMusicSignedIn } from "@/settings/ytAccount";

import { ExportSheet } from "./YtExportPicker";
import { PickerSheet } from "./YtLibraryPicker";

/** Whose library a picker lists. */
export type LibraryService = "ytMusic" | "spotify";

/**
 * The picker that is up, if any (`YtLibraryPickerHost` draws it): an
 * import's, with whoever opened it waiting for [settle], or Export's.
 */
type Shown =
  | { readonly service: LibraryService; readonly settle: (imported: boolean) => void }
  | "export"
  | null;
const shown = makeExternalStore<Shown>(null);

/** [onClosed], answering once whatever settles it. */
const once = (onClosed?: (imported: boolean) => void): ((imported: boolean) => void) => {
  let answered = false;
  return (imported) => {
    if (answered) return;
    answered = true;
    onClosed?.(imported);
  };
};

/** Puts [next] up (or nothing); an import picker it takes the place of imported nothing. */
const show = (next: Shown): void => {
  const last = shown.get();
  shown.set(next);
  if (last !== null && last !== "export" && last !== next) last.settle(false);
};

/**
 * From YT Music: the picker, once signed in. Signed out (or the session
 * expired), the sign-in opens first; leaving it opens nothing.
 */
export const openYtLibraryImport = async (
  onClosed?: (imported: boolean) => void,
): Promise<void> => {
  if ((await ytMusicSignedIn()) || (await signInToYtMusic()))
    show({ service: "ytMusic", settle: once(onClosed) });
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
    show({ service: "spotify", settle: once(onClosed) });
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
    show("export");
};

/**
 * Draws the picker while it's up; mounted once at the root. Torn down with a
 * picker up, it takes the picker down too, so an import picker imported nothing.
 */
export function YtLibraryPickerHost() {
  const open = useSyncExternalStore(shown.subscribe, shown.get);
  useEffect(() => () => show(null), []);
  const closeExport = useCallback(() => {
    if (shown.get() === "export") show(null);
  }, []);
  /** An import picker's sheet has gone: down at once, answering once its Import starts or not. */
  const closeImport = useCallback(
    (imported: Promise<boolean>) => {
      if (open === null || open === "export") return;
      if (shown.get() === open) shown.set(null);
      void imported.then(open.settle, () => open.settle(false));
    },
    [open],
  );
  if (open === null) return null;
  if (open === "export") return <ExportSheet onClosed={closeExport} />;
  return <PickerSheet key={open.service} service={open.service} onClosed={closeImport} />;
}
