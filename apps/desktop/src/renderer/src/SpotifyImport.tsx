/**
 * Import Playlists › From Spotify: the account's Liked Songs and playlists to tick, with Cancel,
 * Select All, Import and Import & Download, as the phone's picker. Main reads the account and
 * makes the playlists (`window.wave.spotifyImport`); the ticks are Core's picker model.
 */
import {
  pressYtLibrarySelectAll,
  toggleYtLibraryRow,
  ytLibraryPickerView,
  type YtLibraryFailureView,
  type YtLibraryPicker,
  type YtLibraryRow,
} from "@wave/core";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MissingImportSongs, SpotifyImportResult } from "../../shared/spotifyImport.ts";
import { trapTab } from "./SongActions.tsx";
import { text } from "./text.ts";

type State =
  /** Reading the library; [signingIn] while the browser has the sign-in. */
  | { readonly kind: "reading"; readonly signingIn: boolean }
  | { readonly kind: "failed"; readonly failure: YtLibraryFailureView }
  | { readonly kind: "picking"; readonly picker: YtLibraryPicker; readonly importing: boolean };

const pickerOf = (rows: readonly YtLibraryRow[]): YtLibraryPicker => ({
  rows,
  // Main keeps where each playlist came from; the window only ticks.
  origins: new Map(),
  favorites: false,
});

/**
 * What the picker shows next: the rows, why they weren't read, or nothing (a cancelled sign-in
 * closes it). [signingIn] hears that the browser has the sign-in.
 */
const readLibrary = async (signIn: boolean, signingIn: () => void): Promise<State | "close"> => {
  try {
    const account = (await window.wave.spotifyAccount.view()).account;
    if (account.kind === "signedOut" && (signIn || account.action === "signIn")) signingIn();
    const library = await window.wave.spotifyImport.library(signIn);
    if (library.status === "signedOut") return "close";
    if (library.status === "failed")
      return { kind: "failed", failure: { line: library.line, action: library.action } };
    return { kind: "picking", picker: pickerOf(library.rows), importing: false };
  } catch {
    return {
      kind: "failed",
      failure: { line: text.imports.spotifyLibraryFailed, action: "tryAgain" },
    };
  }
};

export function SpotifyImportDialog({
  onStarted,
  onImported,
  onClose,
}: {
  /** Import or Import & Download was pressed with playlists ticked. */
  readonly onStarted: () => void;
  /** Import ended: the playlists it made, and what it left out. */
  readonly onImported: (result: SpotifyImportResult) => void;
  readonly onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "reading", signingIn: false });
  const open = useRef(true);
  const bridge = window.wave.spotifyImport;

  // The newest callback, without reading the library again each time the page renders.
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  }, [onClose]);

  /** Reads the library into the picker; the dialog already says it is reading. */
  const load = useCallback(
    (signIn: boolean) =>
      readLibrary(signIn, () => {
        if (open.current) setState({ kind: "reading", signingIn: true });
      }).then((next) => {
        if (!open.current) return;
        if (next === "close") closing.current();
        else setState(next);
      }),
    [],
  );
  useEffect(() => {
    open.current = true;
    void load(false);
    return () => {
      open.current = false;
    };
  }, [load]);
  /** Try Again and Sign In Again. */
  const read = (signIn: boolean) => {
    setState({ kind: "reading", signingIn: false });
    void load(signIn);
  };

  const cancel = () => {
    if (state.kind === "reading") void window.wave.spotifyAccount.cancelSignIn().catch(() => {});
    if (state.kind === "picking" && state.importing) {
      // The playlists made so far stay; the result closes the picker.
      void bridge.cancel().catch(() => {});
      return;
    }
    onClose();
  };

  const run = async (picker: YtLibraryPicker, download: boolean) => {
    setState({ kind: "picking", picker, importing: true });
    onStarted();
    try {
      const result = await bridge.run(
        picker.rows.flatMap((row) => (row.ticked ? [row.playlistId] : [])),
        download,
      );
      onImported(result);
      if (!open.current) return;
      // An import that stopped says why, with Try Again or Sign In Again.
      if (result.failure === null) onClose();
      else setState({ kind: "failed", failure: result.failure });
    } catch {
      if (open.current)
        setState({
          kind: "failed",
          failure: { line: text.imports.couldntImportPlaylists, action: "tryAgain" },
        });
    }
  };

  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else trapTab(event);
  };
  const picking = state.kind === "picking" ? state : undefined;
  const view = picking && ytLibraryPickerView(picking.picker);
  const change = (next: YtLibraryPicker) =>
    setState({ kind: "picking", picker: next, importing: false });

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog spotify-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spotify-import-title"
        data-testid="spotify-import"
        onKeyDown={keys}
      >
        <h2 id="spotify-import-title">{text.imports.importFromSpotify}</h2>
        {state.kind === "reading" && (
          <p className="secondary" role="status">
            {state.signingIn
              ? text.desktopAccount.finishInBrowser
              : text.imports.readingSpotifyLibrary}
          </p>
        )}
        {state.kind === "failed" && (
          <>
            <p className="secondary" role="alert">
              {state.failure.line}
            </p>
            {state.failure.action !== null && (
              <div className="account-actions">
                <button autoFocus onClick={() => read(state.failure.action === "signIn")}>
                  {state.failure.action === "tryAgain"
                    ? text.imports.tryAgain
                    : text.imports.signInAgain}
                </button>
              </div>
            )}
          </>
        )}
        {picking && view && (
          <>
            {view.selectAll !== null && (
              <div className="account-actions">
                <button
                  disabled={picking.importing}
                  onClick={() => change(pressYtLibrarySelectAll(picking.picker))}
                >
                  {view.selectAll === "Select All"
                    ? text.imports.selectAll
                    : text.imports.deselectAll}
                </button>
              </div>
            )}
            <ul className="spotify-import-rows">
              {picking.picker.rows.map((row) => (
                <li key={row.playlistId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={row.ticked}
                      disabled={picking.importing}
                      onChange={() => change(toggleYtLibraryRow(picking.picker, row.playlistId))}
                    />
                    <span className="yt-account-cover">
                      <Cover source={row.playlistId} has={row.artworkUrl !== null} />
                    </span>
                    <span className="yt-account-names">
                      <span>{row.title}</span>
                      {row.line !== null && <span className="secondary">{row.line}</span>}
                    </span>
                    {row.imported && (
                      <span className="secondary spotify-import-imported">
                        {text.imports.imported}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {picking.importing && (
              <p className="secondary" role="status">
                {text.settings.importing}
              </p>
            )}
          </>
        )}
        <div className="dialog-buttons">
          <button onClick={cancel}>{text.imports.cancel}</button>
          {picking && view && (
            <>
              <button
                disabled={!view.canImport || picking.importing}
                onClick={() => void run(picking.picker, true)}
              >
                {text.imports.importDownload}
              </button>
              <button
                className="accent"
                disabled={!view.canImport || picking.importing}
                onClick={() => void run(picking.picker, false)}
              >
                {text.imports.import}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A row's cover, read through main once the row is in sight. */
function Cover({ source, has }: { readonly source: string; readonly has: boolean }) {
  const [image, setImage] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!has || element === null) return;
    let current = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void window.wave.spotifyImport
        .artwork(source)
        .then((value) => {
          if (current) setImage(value);
        })
        .catch(() => {});
    });
    observer.observe(element);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [source, has]);
  return (
    <span className="artwork" ref={box} aria-hidden>
      {image !== null && <img src={image} alt="" onError={() => setImage(null)} />}
    </span>
  );
}

/** How often a playlist's missing songs are read again while YT Music is looking them up. */
const FINDING_EVERY_MS = 2_000;

/**
 * A playlist page's songs the Library lacks (an import's songs not looked up yet, not found
 * online, or local files on Spotify): how many, beside Play and Shuffle, and their list. Reading
 * them has main look the pending ones up on YT Music; each one found takes its place on the page.
 */
export function PlaylistMissingSongs({
  playlistId,
  revision,
}: {
  readonly playlistId: number;
  /** Changes when the playlist's songs may have. */
  readonly revision: string;
}) {
  const [read, setRead] = useState<{ readonly id: number; readonly missing: MissingImportSongs }>();
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void window.wave.spotifyImport
      .missing(playlistId)
      .then((missing) => {
        if (!live) return;
        setRead({ id: playlistId, missing });
        if (missing.finding) timer = setTimeout(() => setTick((n) => n + 1), FINDING_EVERY_MS);
      })
      .catch(() => {});
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [playlistId, revision, tick]);
  const missing = read?.id === playlistId ? read.missing : undefined;
  if (missing === undefined || missing.total === 0) return null;
  const label = text.imports.notInLibrary(missing.total);
  const lines = {
    unsearched: missing.finding ? text.imports.findingSong : null,
    notFound: text.library.unavailable.notFound,
    localFile: text.library.unavailable.localFile,
  };
  const close = () => setOpen(false);
  return (
    <>
      <button data-testid="missing-songs" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="missing-songs-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              } else trapTab(event);
            }}
          >
            <h2 id="missing-songs-title">{label}</h2>
            <ul className="spotify-import-rows missing-songs">
              {missing.songs.map((song, index) => (
                <li key={index}>
                  <span className="yt-account-names">
                    <span>{song.title}</span>
                    <span className="secondary">
                      {[song.artist, lines[song.state]].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="dialog-buttons">
              <button className="accent" autoFocus onClick={close}>
                {text.imports.ok}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
