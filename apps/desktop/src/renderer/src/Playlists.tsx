/**
 * Editing playlists as on the phone: New Playlist, Rename, Delete, the playlist's image, Move Up
 * and Move Down, and importing M3U files. Main does the work (`window.wave.playlists`); these
 * dialogs ask and show.
 */
import {
  adjustFraming,
  confirmImportReplace,
  confirmPlaylistDeletion,
  describePlaylistAdd,
  framingView,
  panFraming,
  pinchFraming,
  summarizeM3uImport,
  type AlertSpec,
  type ImageFraming,
  type M3uImportSummary,
  type PlaylistNameCheck,
} from "@wave/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type {
  ImageEdit,
  ImportAnswer,
  PlaylistCreateTarget,
  PlaylistInfo,
} from "../../shared/playlists.ts";
import type { SpotifyImportResult } from "../../shared/spotifyImport.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import "./playlists.css";
import { copyLink } from "./copyLink.ts";
import { shareToSpotify } from "./shareToSpotify.ts";
import type { MenuItem, MenuPoint } from "./Menu.tsx";
import { ConfirmDialog, trapTab, useMenuAndToast } from "./SongActions.tsx";
import { SpotifyImportDialog } from "./SpotifyImport.tsx";
import { language, text } from "./text.ts";

type FramingAdjustment = Parameters<typeof adjustFraming>[2];

interface Options {
  /** Opens a playlist's page, or its Graveyard. */
  readonly go: (route: { readonly kind: "playlist" | "graveyard"; readonly id: number }) => void;
  /** A playlist was deleted: leave its pages. */
  readonly deleted: (playlistId: number) => void;
  /** Says an edit failed, in the window's error line. */
  readonly failed: (message: string) => void;
  /** Reads the player, the rows and the sidebar again once an edit changed them. */
  readonly changed: () => void;
  /** From Spotify's import started: Bring your music marks the source. */
  readonly importStarted?: (source: "spotify") => void;
}

/** The menu entries that change a collaborative playlist for every member. */
const EDITS: ReadonlySet<string> = new Set(["renamePlaylist", "graveyard", "deletePlaylist"]);

type Naming =
  | { readonly kind: "create"; readonly initial: string; readonly target?: PlaylistCreateTarget }
  | { readonly kind: "rename"; readonly initial: string; readonly playlistId: number };

/** The dialogs, menu and toast playlist edits show, and how to open them. */
export function usePlaylistEdits({ go, deleted, failed, changed, importStarted }: Options) {
  /** Counts edits the player's revision misses (a playlist's image), for whatever shows them. */
  const [edits, setEdits] = useState(0);
  const [naming, setNaming] = useState<Naming>();
  const { setMenu, setToast, menuAndToast } = useMenuAndToast();
  const [confirm, setConfirm] = useState<{
    readonly spec: AlertSpec;
    readonly onChoose: (yes: boolean) => void;
  }>();
  const [crop, setCrop] = useState<{ readonly playlistId: number; readonly edit: ImageEdit }>();
  const [summary, setSummary] = useState<M3uImportSummary>();
  const [fromSpotify, setFromSpotify] = useState(false);

  const edited = useCallback(() => {
    setEdits((n) => n + 1);
    changed();
  }, [changed]);
  const ask = (spec: AlertSpec) =>
    new Promise<boolean>((resolve) =>
      setConfirm({
        spec,
        onChoose: (yes) => {
          setConfirm(undefined);
          resolve(yes);
        },
      }),
    );

  /** New Playlist: asks for a name; with [target], the new playlist holds its songs. */
  const newPlaylist = useCallback(
    (target?: PlaylistCreateTarget) => {
      void window.wave.playlists
        .newName()
        .then((initial) => setNaming({ kind: "create", initial, ...(target ? { target } : {}) }))
        .catch(() => failed(text.playlists.couldntCreate));
    },
    [failed],
  );

  const named = async (naming: Naming, name: string) => {
    if (naming.kind === "rename") {
      try {
        await window.wave.playlists.rename(naming.playlistId, name);
        edited();
      } catch {
        failed(text.playlists.couldntRename);
      }
      return;
    }
    try {
      const made = await window.wave.playlists.create(name, naming.target);
      edited();
      if (naming.target === undefined) go({ kind: "playlist", id: made.id });
      else
        setToast({
          message: describePlaylistAdd(made.name, made.added, 0, language),
          id: Date.now(),
        });
    } catch {
      failed(text.playlists.couldntCreate);
    }
  };

  const framePhoto = (playlistId: number, read: Promise<ImageEdit | null>, problem: string) => {
    void read
      .then((edit) => {
        if (edit !== null) setCrop({ playlistId, edit });
      })
      .catch(() => failed(problem));
  };

  /**
   * A playlist's menu: Rename, its image, its Graveyard and Delete. A collaborative one keeps
   * only what is this device's own (its image) and sharing: the desktop edits none of it.
   */
  const playlistItems = async (playlistId: number): Promise<readonly MenuItem[]> => {
    const info = await window.wave.playlists.info(playlistId);
    if (info === null) return [{ key: "deleted", label: text.playlists.deleted, disabled: true }];
    const items = await allPlaylistItems(playlistId, info, await window.wave.settings.ytMusic());
    return info.collaborative
      ? [
          {
            key: "collaborative",
            label: text.desktopLibrary.collaborativeOnPhone,
            disabled: true,
          },
          ...items.filter((item) => !EDITS.has(item.key)),
        ]
      : items;
  };

  const allPlaylistItems = async (
    playlistId: number,
    info: PlaylistInfo,
    ytMusic: boolean,
  ): Promise<readonly MenuItem[]> => {
    const labels = text.itemActions.labels;
    return [
      {
        key: "renamePlaylist",
        label: labels.renamePlaylist,
        run: () => setNaming({ kind: "rename", initial: info.name, playlistId }),
      },
      {
        key: "changeImage",
        label: labels.changeImage,
        run: () =>
          framePhoto(
            playlistId,
            window.wave.playlists.pickImage(playlistId),
            text.playlists.couldntChangeImage,
          ),
      },
      ...(info.hasImage
        ? [
            {
              key: "adjustImage",
              label: labels.adjustImage,
              run: () =>
                framePhoto(
                  playlistId,
                  window.wave.playlists.adjustImage(playlistId),
                  text.playlists.couldntAdjustImage,
                ),
            },
            {
              key: "removeImage",
              label: labels.removeImage,
              run: () =>
                void window.wave.playlists
                  .removeImage(playlistId)
                  .then(edited)
                  .catch(() => failed(text.playlists.couldntRemoveImage)),
            },
          ]
        : []),
      ...(info.graveyard > 0
        ? [
            {
              key: "graveyard",
              label: text.playlists.graveyard,
              run: () => go({ kind: "graveyard", id: playlistId }),
            },
          ]
        : []),
      ...(ytMusic
        ? [
            {
              key: "share",
              label: text.share.copyLink,
              run: () => {
                void copyLink(window.wave.links.copyPlaylist(playlistId));
              },
            },
          ]
        : []),
      ...((await window.wave.spotifyAccount.view()).configured
        ? [
            {
              key: "shareToSpotify",
              label: text.share.shareToSpotify,
              run: () =>
                void shareToSpotify({ id: playlistId, name: info.name }, ask, (message) =>
                  setToast({ message, id: Date.now() }),
                ),
            },
          ]
        : []),
      {
        key: "deletePlaylist",
        label: labels.deletePlaylist,
        destructive: true,
        run: () =>
          void ask(confirmPlaylistDeletion([{ name: info.name }], language)).then(async (yes) => {
            if (!yes) return;
            try {
              await window.wave.playlists.delete(playlistId);
              deleted(playlistId);
              edited();
            } catch {
              failed(text.playlists.couldntDelete(1));
            }
          }),
      },
    ];
  };

  /** Move Up and Move Down, for a song's menu on its playlist's page. */
  const moveItems = (playlistId: number, trackId: number): readonly MenuItem[] =>
    (["up", "down"] as const).map((direction) => ({
      key: `move-${direction}`,
      label: direction === "up" ? text.playlists.moveUp : text.playlists.moveDown,
      run: () =>
        void window.wave.playlists
          .move(playlistId, trackId, direction)
          .then(changed)
          .catch(() => failed(text.desktopLibrary.actionFailed)),
    }));

  /** A drag or Alt+arrow on a playlist's page: [target] goes before row [before], or to the end. */
  const place = (playlistId: number, target: SongTarget, before: number | null) =>
    void window.wave.playlists
      .place(playlistId, target, before)
      .then(changed)
      .catch(() => failed(text.desktopLibrary.actionFailed));

  /** From Files: the file picker, a question per name another playlist has, the summary. */
  const importFiles = async () => {
    try {
      const choice = await window.wave.playlists.chooseImport();
      if (choice === null) return;
      const answers: ImportAnswer[] = [];
      for (const file of choice.files)
        answers.push(
          file.clash !== null && (await ask(confirmImportReplace(file.clash, language)))
            ? "replace"
            : "keepBoth",
        );
      const result = await window.wave.playlists.runImport(answers);
      edited();
      setSummary(summarizeM3uImport(result.outcomes, language));
    } catch {
      failed(text.imports.couldntImportPlaylists);
    }
  };

  /** Import Playlists: From Files, and From Spotify while YT Music is on; at [at], the choice. */
  const importPlaylists = async (at?: MenuPoint) => {
    const ytMusic = await window.wave.settings.ytMusic().catch(() => false);
    if (!ytMusic || at === undefined) return importFiles();
    setMenu({
      label: text.playlists.importPlaylists,
      at,
      items: [
        { key: "fromFiles", label: text.imports.fromFiles, run: () => void importFiles() },
        { key: "fromSpotify", label: text.imports.fromSpotify, run: () => setFromSpotify(true) },
      ],
    });
  };

  /** From Spotify's Import ended: one playlist opens, several are counted, and what it left out is said. */
  const importedFromSpotify = ({ imported, skipped, failure }: SpotifyImportResult) => {
    edited();
    const [first] = imported;
    if (first !== undefined) {
      if (imported.length === 1) go({ kind: "playlist", id: first.playlistId });
      setToast({
        message:
          imported.length === 1
            ? text.imports.importedName(first.name)
            : text.imports.importedPlaylists(imported.length),
        id: Date.now(),
      });
    }
    if (failure === null && skipped > 0)
      failed(
        skipped === 1 ? text.imports.couldntImportPlaylist : text.imports.couldntImportPlaylists,
      );
  };

  const overlays = (
    <>
      {menuAndToast}
      {naming && (
        <NameDialog
          naming={naming}
          onClose={(name) => {
            setNaming(undefined);
            if (name !== undefined) void named(naming, name);
          }}
        />
      )}
      {crop && (
        <CropDialog
          edit={crop.edit}
          onClose={(framing) => {
            setCrop(undefined);
            const save =
              framing === undefined
                ? window.wave.playlists.cancelImage()
                : window.wave.playlists.saveImage(crop.playlistId, framing).then(edited);
            void save.catch(() => failed(text.playlists.couldntChangeImage));
          }}
        />
      )}
      {summary && <SummaryDialog summary={summary} onClose={() => setSummary(undefined)} />}
      {fromSpotify && (
        <SpotifyImportDialog
          onStarted={() => importStarted?.("spotify")}
          onImported={importedFromSpotify}
          onClose={() => setFromSpotify(false)}
        />
      )}
      {confirm && <ConfirmDialog spec={confirm.spec} onChoose={confirm.onChoose} />}
    </>
  );
  return {
    edits,
    newPlaylist,
    playlistItems,
    moveItems,
    place,
    importPlaylists: (at?: MenuPoint) => void importPlaylists(at),
    /** Opens the From Spotify picker (it signs in first when signed out). */
    importFromSpotify: () => setFromSpotify(true),
    overlays,
  };
}

/** Esc closes, Tab stays inside. */
const dialogKeys = (close: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  } else trapTab(event);
};

const problems = () =>
  ({
    empty: text.playlists.nameEmpty,
    taken: text.playlists.nameTaken,
    tooLong: text.playlists.nameTooLong,
  }) as const;

/** New Playlist and Rename: the name, checked as it is typed by Core's rules. */
function NameDialog({
  naming,
  onClose,
}: {
  readonly naming: Naming;
  readonly onClose: (name?: string) => void;
}) {
  const [name, setName] = useState(naming.initial);
  const [check, setCheck] = useState<{
    readonly name: string;
    readonly check: PlaylistNameCheck;
  }>();
  const playlistId = naming.kind === "rename" ? naming.playlistId : undefined;
  useEffect(() => {
    let current = true;
    void window.wave.playlists
      .checkName(name, playlistId)
      .then((result) => {
        if (current) setCheck({ name, check: result });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [name, playlistId]);
  const result = check?.name === name ? check.check : undefined;
  // The suggested name is shown without a complaint until it is edited.
  const problem =
    result?.ok === false && name !== naming.initial ? problems()[result.problem] : null;
  const title =
    naming.kind === "create" ? text.playlists.newPlaylistTitle : text.playlists.renamePlaylist;
  const submit = () => {
    if (result?.ok) onClose(result.name);
  };
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-name-title"
        onKeyDown={dialogKeys(() => onClose())}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id="playlist-name-title">{title}</h2>
        <input
          className="dialog-input"
          aria-label={text.playlists.playlistName}
          aria-invalid={problem !== null}
          aria-describedby="playlist-name-problem"
          autoFocus
          value={name}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
        />
        <p id="playlist-name-problem" className="dialog-problem" role="status">
          {problem}
        </p>
        <div className="dialog-buttons">
          <button type="button" onClick={() => onClose()}>
            {text.playlists.cancel}
          </button>
          <button type="submit" className="accent" disabled={!result?.ok}>
            {naming.kind === "create" ? text.playlists.create : text.playlists.rename}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The crop square's side, in px. */
const VIEW = 280;

const KEYS: Partial<Record<string, FramingAdjustment>> = {
  ArrowLeft: "moveLeft",
  ArrowRight: "moveRight",
  ArrowUp: "moveUp",
  ArrowDown: "moveDown",
  "+": "zoomIn",
  "=": "zoomIn",
  "-": "zoomOut",
  "0": "reset",
};

/** Change Image and Adjust Image: drag to move, the wheel or the buttons to zoom, as the phone's cropper. */
function CropDialog({
  edit,
  onClose,
}: {
  readonly edit: ImageEdit;
  readonly onClose: (framing?: ImageFraming) => void;
}) {
  const size = { width: edit.width, height: edit.height };
  const [framing, setFraming] = useState(edit.framing);
  const drag = useRef<MenuPoint | undefined>(undefined);
  const view = framingView(size, VIEW, framing);
  const adjust = (action: FramingAdjustment) => setFraming((f) => adjustFraming(size, f, action));
  const library = text.library;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
        onKeyDown={dialogKeys(() => onClose())}
      >
        <h2 id="crop-title">{library.moveAndScale}</h2>
        <div
          className="crop-square"
          style={{ width: VIEW, height: VIEW }}
          tabIndex={0}
          role="img"
          aria-label={`${library.photoFraming}, ${library.framingValue(
            framing.zoom,
            Math.round(framing.centerX * 100),
            Math.round(framing.centerY * 100),
          )}`}
          onKeyDown={(event) => {
            const action = KEYS[event.key];
            if (action === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            adjust(action);
          }}
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const from = drag.current;
            if (from === undefined) return;
            drag.current = { x: event.clientX, y: event.clientY };
            setFraming((f) =>
              panFraming(size, VIEW, f, event.clientX - from.x, event.clientY - from.y),
            );
          }}
          onPointerUp={() => (drag.current = undefined)}
          onPointerCancel={() => (drag.current = undefined)}
          onWheel={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const factor = Math.exp(-event.deltaY / 400);
            setFraming((f) =>
              pinchFraming(
                size,
                VIEW,
                f,
                factor,
                event.clientX - box.left,
                event.clientY - box.top,
              ),
            );
          }}
        >
          <img
            src={edit.photo}
            alt=""
            draggable={false}
            style={{
              width: edit.width,
              height: edit.height,
              transform: `translate(${view.translateX}px, ${view.translateY}px) scale(${view.scale})`,
            }}
          />
        </div>
        <div className="crop-tools">
          <button type="button" onClick={() => adjust("zoomOut")}>
            {library.zoomOut}
          </button>
          <button type="button" onClick={() => adjust("zoomIn")}>
            {library.zoomIn}
          </button>
          <button type="button" onClick={() => adjust("reset")}>
            {library.resetFraming}
          </button>
        </div>
        <div className="dialog-buttons">
          <button type="button" onClick={() => onClose()}>
            {library.cancel}
          </button>
          <button type="button" className="accent" onClick={() => onClose(framing)}>
            {library.done}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What an import did: a section per file, with the songs left out listed under it. */
function SummaryDialog({
  summary,
  onClose,
}: {
  readonly summary: M3uImportSummary;
  readonly onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onKeyDown={dialogKeys(onClose)}
      >
        <h2 id="import-title">{summary.title}</h2>
        <div className="import-summary">
          {summary.sections.map((section, index) => (
            <section key={index}>
              <h3 className="truncate">{section.heading}</h3>
              <p className="secondary">{section.detail}</p>
              {section.missing.length > 0 && (
                <ul className="secondary import-missing">
                  {section.missing.map((entry, at) => (
                    <li key={at} className="truncate">
                      {entry}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
        <div className="dialog-buttons">
          <button className="accent" autoFocus onClick={onClose}>
            {text.imports.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
