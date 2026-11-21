/**
 * A song's menu, the selection bar and what their entries do: the phone's entries (Core's
 * `desktopSongActions`, read through `window.wave.songs`) with the phone's toasts.
 */
import {
  allTableRows,
  actionBarLabel,
  checkedTableRow,
  confirmSongRemoval,
  isDestructiveAction,
  planAlert,
  splitActionBar,
  tagLookupsToast,
  toastDuration,
  tableSelectionOf,
  type ActionSurface,
  type AlertSpec,
  type DesktopSongEntry,
  type TableSelection,
  type UpNextPlace,
} from "@wave/core";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import {
  MAX_TARGET_IDS,
  type SongMenu,
  type SongRunAction,
  type SongTarget,
} from "../../shared/songActions.ts";
import { Menu, type MenuItem, type OpenMenu } from "./Menu.tsx";
import { ReleaseDateDialog, type ReleaseDateSong } from "./ReleaseDate.tsx";
import { songShareItems } from "./SongShare.tsx";
import { songActionToast } from "./songActionToast.ts";
import { language, text } from "./text.ts";
import type { DraggedSongs } from "./songDrag.ts";
import type { SelectionTarget } from "../../shared/collectionActions.ts";
import type { TableSelectionProps } from "./useTableSelection.ts";

export function selectionTarget(scope: BrowseScope, selection: TableSelection): SongTarget | null {
  const ids =
    selection.ids.size > MAX_TARGET_IDS ? Float64Array.from(selection.ids) : [...selection.ids];
  if (selection.all) return { scope, all: true, except: ids };
  return ids.length === 0 ? null : { scope, ids };
}

type Route = { readonly kind: "album" | "artist"; readonly id: number };

interface Options {
  /** Opens an album's or an artist's page. */
  readonly go: (route: Route) => void;
  /** Turns selection on with [ids] checked. */
  readonly select: (ids: Iterable<number>) => void;
  /** Says an action failed, in the window's error line. */
  readonly failed: (message?: string) => void;
  /** Reads the player and the rows again once an action changed them. */
  readonly changed: () => void;
  /** New Playlist from Add to Playlist: asks for a name, then makes it with [target]'s songs. */
  readonly newPlaylist?: (target: SongTarget) => void;
}

interface Confirm {
  readonly spec: AlertSpec;
  readonly onAction: () => void;
}

/** The playlists Add to Playlist offers: the sidebar's first page, but the collaborative ones. */
const playlists = async () =>
  (await window.wave.library.browse({ kind: "playlists" }, 0, 200)).items.filter(
    (row) => !row.collaborative,
  );

/** The menus, toasts and question an entry can show, and how to open them. */
export function useSongActions({ go, select, failed, changed, newPlaylist }: Options) {
  const { menu, setMenu, setToast, menuAndToast } = useMenuAndToast();
  const [confirm, setConfirm] = useState<Confirm>();
  /** The song whose Release Date is open. */
  const [releaseDate, setReleaseDate] = useState<ReleaseDateSong>();

  const notify = useCallback(
    (message: string | null, undo?: () => void, action?: ToastAction) => {
      if (message !== null)
        setToast({
          message,
          id: Date.now(),
          ...(undo ? { undo } : {}),
          ...(action ? { action } : {}),
        });
    },
    [setToast],
  );

  const run = useCallback(
    async (
      target: SongTarget,
      action: SongRunAction,
      surface: ActionSurface,
      id?: number,
      at?: UpNextPlace,
    ) => {
      try {
        // Each song waits on LRCLIB and Deezer: say it's under way.
        if (action === "fixSong" || action === "fixSongs") notify(text.fixSongs.progress);
        const result = await window.wave.songs.run(target, action, id, at);
        changed();
        switch (result.kind) {
          case "downloaded":
            return;
          case "queued":
            return notify(songActionToast(result, action === "playNext", surface, result.count));
          case "favorite":
          case "playlist":
            return notify(songActionToast(result, false, surface, 0));
          case "removed":
            return;
          case "fixed":
            return notify(tagLookupsToast(result.results, result.stop, result.skipped, text));
          case "playlistRemoved":
            return notify(text.playlists.removed(result.count), () => {
              void window.wave.playlists
                .undoRemove()
                .then(changed)
                .catch(() => failed(text.playlists.couldntRestore));
            });
        }
      } catch {
        failed(action === "removeFromLibrary" ? text.songDeletion.couldntRemoveSongs : undefined);
      }
    },
    [changed, failed, notify],
  );

  /** [entry] as a menu item or a bar button; [finish] ends selection once it runs. */
  const itemFor = useCallback(
    (
      entry: DesktopSongEntry,
      target: SongTarget,
      about: SongMenu,
      surface: ActionSurface,
      finish: () => void,
    ): MenuItem => {
      if (entry.action === "showInFolder") {
        // Core offers it on one Library song's menu: main finds its file by the id.
        const [id] = "ids" in target ? target.ids : [];
        const label = text.desktopLibrary.showInFolder;
        if (id === undefined) return { key: entry.action, label, disabled: true };
        return {
          key: entry.action,
          label,
          run: () =>
            void window.wave.songs
              .showInFolder(id)
              .then((result) => {
                if (result === "unavailable") failed(text.desktopLibrary.driveDisconnected);
                else if (result === "gone") failed(text.desktopLibrary.fileGone);
              })
              .catch(() => failed()),
        };
      }
      const { action } = entry;
      const label =
        surface === "selection"
          ? actionBarLabel(action, language)
          : text.itemActions.labels[action];
      const base = { key: action, label, destructive: isDestructiveAction(action) };
      switch (entry.action) {
        case "playNext":
        case "addToQueue":
        case "favorite":
        case "download":
        case "unfavorite":
        case "fixSong":
        case "fixSongs":
          return {
            ...base,
            run: () => {
              finish();
              void run(target, entry.action as SongRunAction, surface);
            },
          };
        case "addToPlaylist":
          return {
            ...base,
            open: async () => {
              const rows = await playlists();
              const create: MenuItem[] = newPlaylist
                ? [
                    {
                      key: "new-playlist",
                      label: text.playlists.newPlaylist,
                      run: () => {
                        finish();
                        newPlaylist(target);
                      },
                    },
                  ]
                : [];
              return rows.length === 0
                ? [
                    ...create,
                    { key: "none", label: text.desktopLibrary.noPlaylists, disabled: true },
                  ]
                : [
                    ...create,
                    ...rows.map((row) => ({
                      key: `playlist-${row.id}`,
                      label: row.title,
                      run: () => {
                        finish();
                        void run(target, "addToPlaylist", surface, row.id);
                      },
                    })),
                  ];
            },
          };
        case "removeFromPlaylist":
          // As on the phone: no question, and the toast's Undo puts the songs back.
          return {
            ...base,
            run: () => {
              finish();
              void run(target, "removeFromPlaylist", surface);
            },
          };
        case "goToAlbum":
          return {
            ...base,
            run: () => {
              finish();
              go({ kind: "album", id: entry.albumId });
            },
          };
        case "goToArtist": {
          if (!("artists" in entry)) return { ...base, disabled: true };
          const link = entry.artists;
          if (link.kind === "open")
            return {
              ...base,
              run: () => {
                finish();
                go({ kind: "artist", id: link.artistId });
              },
            };
          return {
            ...base,
            submenu: text.desktopLibrary.chooseArtist,
            open: async () =>
              about.artists.map((artist) => ({
                key: `artist-${artist.id}`,
                label: artist.name,
                run: () => {
                  finish();
                  go({ kind: "artist", id: artist.id });
                },
              })),
          };
        }
        case "select":
          return {
            ...base,
            run: () => select("ids" in target ? target.ids : []),
          };
        case "removeFromLibrary":
          return {
            ...base,
            run: () =>
              setConfirm({
                spec: confirmSongRemoval(
                  Array.from({ length: about.count }, () => ({ title: about.title ?? "" })),
                  text,
                ),
                // In selection, selection ends only once the question is answered yes.
                onAction: () => {
                  finish();
                  void run(target, "removeFromLibrary", surface);
                },
              }),
          };
        case "releaseDate":
          return { ...base, run: () => setReleaseDate(target) };
        case "share":
          return {
            ...base,
            submenu: text.itemActions.labels.share,
            open: () => songShareItems(target, (message) => notify(message)),
          };
        case "magicQueue":
          return {
            ...base,
            run: () => {
              finish();
              const couldnt = () => failed(text.playbackText.couldntStartTheMagicQueue);
              void window.wave.magicQueue
                .start(target)
                .then((started) => {
                  changed();
                  if (!started) couldnt();
                })
                .catch(couldnt);
            },
          };
        default:
          // An action the desktop doesn't offer.
          return { ...base, disabled: true };
      }
    },
    [go, run, select, changed, failed, newPlaylist, notify],
  );

  /** Opens a song or selection menu at [at]. */
  const openMenu = useCallback(
    (
      target: SongTarget,
      title: string,
      at: { readonly x: number; readonly y: number },
      extra: readonly MenuItem[] = [],
      options?: {
        readonly select?: () => void;
        readonly done?: () => void;
        readonly label?: string;
      },
    ) =>
      setMenu({
        label: options?.label ?? text.desktopLibrary.songMenu(title),
        at,
        items: window.wave.songs.actions(target, "menu").then((about) => [
          ...about.entries.flatMap((entry) =>
            entry.action !== "select"
              ? [itemFor(entry, target, about, "menu", options?.done ?? (() => {}))]
              : options?.done
                ? []
                : [
                    {
                      ...itemFor(entry, target, about, "menu", () => {}),
                      ...(options?.select ? { run: options.select } : {}),
                    },
                  ],
          ),
          ...extra,
        ]),
      }),
    [itemFor, setMenu],
  );

  /** Opens a menu of [items] under [element] (the selection bar's More and submenus). */
  const openItems = useCallback(
    (
      label: string,
      items: Promise<readonly MenuItem[]> | readonly MenuItem[],
      /** The element the menu opens under, or the point it opens at. */
      from: Element | { readonly x: number; readonly y: number },
    ) => {
      const rect = from instanceof Element ? from.getBoundingClientRect() : undefined;
      const at = rect ? { x: rect.left, y: rect.bottom + 4 } : (from as { x: number; y: number });
      setMenu({ label, items, at });
    },
    [setMenu],
  );

  const overlays = (
    <>
      {menuAndToast}
      {releaseDate !== undefined && (
        <ReleaseDateDialog
          song={releaseDate}
          failed={failed}
          onClose={(saved) => {
            setReleaseDate(undefined);
            // A playlist sorted by release date places the song again.
            if (saved) changed();
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          spec={confirm.spec}
          onChoose={(yes) => {
            setConfirm(undefined);
            if (yes) confirm.onAction();
          }}
        />
      )}
    </>
  );
  return {
    openMenu,
    openItems,
    itemFor,
    /** Runs an entry on [target] with its toast, as a drop onto a playlist or the Queue does. */
    run,
    overlays,
    /** Opens Release Date for a Library song's target or a streamed song's video id. */
    openReleaseDate: setReleaseDate,
    /** Shows [message] as the window's toast, with Undo or another [action] to offer. */
    notify,
    /** Closes the open menu, if one is; false when none was. */
    closeMenu: () => {
      if (menu === undefined) return false;
      setMenu(undefined);
      return true;
    },
  };
}

/** A button a toast offers besides Undo, such as Download Missing Songs. */
/** A toast that shows: [id] tells one from the next, so each gets its own time. */
interface ShownToast {
  readonly message: string;
  readonly id: number;
  readonly undo?: () => void;
  readonly action?: ToastAction;
}

/** A page's open menu and its toast, with [menuAndToast] to draw them over it. */
export function useMenuAndToast() {
  const [menu, setMenu] = useState<OpenMenu>();
  const [toast, setToast] = useState<ShownToast>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const hideToast = useCallback(() => setToast(undefined), []);
  const menuAndToast = (
    <>
      {menu && <Menu label={menu.label} items={menu.items} at={menu.at} onClose={closeMenu} />}
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          onDone={hideToast}
          onUndo={toast.undo}
          action={toast.action}
        />
      )}
    </>
  );
  return { menu, setMenu, setToast, menuAndToast };
}

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

/** A toast for the phone's time; with [onUndo], an Undo button too, or [action]'s. */
export function Toast({
  message,
  onDone,
  onUndo,
  action,
}: {
  readonly message: string;
  readonly onDone: () => void;
  readonly onUndo?: (() => void) | undefined;
  readonly action?: ToastAction | undefined;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, toastDuration(message));
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="playback-toast action-toast" role="status">
      <span>{message}</span>
      {onUndo && (
        <button
          className="toast-action"
          onClick={() => {
            onDone();
            onUndo();
          }}
        >
          {text.playlists.undo}
        </button>
      )}
      {action && (
        <button
          className="toast-action"
          onClick={() => {
            onDone();
            action.run();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Keeps Tab inside [element]'s buttons. */
export const trapTab = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "Tab") return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button, input")];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
};

/**
 * Wave's alert (Core's `planAlert`): Cancel, or the spec's dismiss label, then the action, the
 * first focused; Esc chooses the first. Without an action it is a message with OK.
 */
export function ConfirmDialog({
  spec,
  onChoose,
}: {
  readonly spec: AlertSpec;
  readonly onChoose: (yes: boolean) => void;
}) {
  const { buttons } = planAlert(spec, text);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onChoose(false);
          } else trapTab(event);
        }}
      >
        <h2 id="confirm-title">{spec.title}</h2>
        <p id="confirm-message" className="secondary">
          {spec.message}
        </p>
        <div className="dialog-buttons">
          {buttons.map((button, index) => (
            <button
              key={button.choice}
              autoFocus={index === 0}
              className={
                button.choice === "dismiss"
                  ? undefined
                  : button.tone === "destructive"
                    ? "destructive"
                    : "accent"
              }
              onClick={() => onChoose(button.choice === "action")}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export type SongSelectionControls = TableSelectionProps & {
  readonly actions: ReturnType<typeof useSongActions>;
  /** False where the songs are checked with collections, whose bar acts on them all. */
  readonly bar?: false;
  /** Where songs are checked with collections: the checked songs with them, as one target. */
  readonly picks?: (songs: SongTarget) => SelectionTarget;
};

/**
 * What dragging [row] carries: the checked rows, in the list's order, when it is one of them
 * (with the collections checked beside them), else the row alone.
 */
export function rowDrag(
  controls: Pick<SongSelectionControls, "selection" | "picks">,
  scope: BrowseScope,
  row: BrowseRow,
): DraggedSongs {
  const { selection, picks } = controls;
  const target =
    selection && checkedTableRow(selection, row.id) ? selectionTarget(scope, selection) : null;
  if (target === null) return { kind: "songs", target: { scope, ids: [row.id] } };
  return picks ? { kind: "selection", target: picks(target) } : { kind: "songs", target };
}

/** A selected row opens the group's menu. Other rows keep their own actions. */
export function openTableSongMenu(
  controls: SongSelectionControls,
  scope: BrowseScope,
  row: BrowseRow,
  at: { readonly x: number; readonly y: number },
  extra: readonly MenuItem[] = [],
) {
  const { selection, onSelection, actions } = controls;
  const target =
    selection && checkedTableRow(selection, row.id) ? selectionTarget(scope, selection) : null;
  if (target !== null) {
    const count = selection?.all ? undefined : selection?.ids.size;
    actions.openMenu(
      target,
      count && count > 1 ? text.library.selected(count) : row.title,
      at,
      [],
      {
        done: () => onSelection?.(undefined),
        ...(selection?.all ? { label: text.library.selectionActions } : {}),
      },
    );
    return;
  }
  actions.openMenu({ scope, ids: [row.id] }, row.title, at, extra, {
    select: () => onSelection?.(tableSelectionOf([row.id], true)),
  });
}

/** The selection bar: how many songs are checked, the phone's actions, Select All and Done. */
export function SelectionBar({
  scope,
  selection,
  revision,
  actions,
  onChange,
  onDone,
  selectAll,
}: {
  readonly scope: BrowseScope;
  readonly selection: TableSelection;
  readonly revision: number;
  readonly actions: ReturnType<typeof useSongActions>;
  readonly onChange: (selection: TableSelection) => void;
  readonly onDone: () => void;
  readonly selectAll?: (() => TableSelection) | undefined;
}) {
  const target = useMemo(() => selectionTarget(scope, selection), [scope, selection]);
  const [about, setAbout] = useState<{ readonly target: SongTarget; readonly menu: SongMenu }>();
  useEffect(() => {
    if (target === null) return;
    let current = true;
    void window.wave.songs
      .actions(target, "selection")
      .then((menu) => {
        if (current) setAbout({ target, menu });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [target, revision]);
  const menu = target !== null && about?.target === target ? about.menu : undefined;
  const count = menu?.count ?? (selection.all ? 0 : selection.ids.size);
  if (!selection.checkboxes && count < 2) return null;
  const items =
    menu === undefined || target === null
      ? []
      : menu.entries.flatMap((entry) =>
          // Show in Folder is one song's menu's, never the bar's.
          entry.action === "showInFolder"
            ? []
            : [{ entry, item: actions.itemFor(entry, target, menu, "selection", onDone) }],
        );
  const { bar, more } = splitActionBar(
    items.map(({ entry, item }) => ({ action: entry.action, item })),
    5,
  );
  return (
    <div className="selection-bar" role="toolbar" aria-label={text.library.selectionActions}>
      <span className="selection-count" role="status">
        {text.library.selected(count)}
      </span>
      <div className="selection-actions">
        {bar.map(({ item }) => (
          <button
            key={item.key}
            className={item.destructive ? "destructive" : undefined}
            disabled={item.disabled}
            onClick={(event) =>
              item.open
                ? actions.openItems(item.submenu ?? item.label, item.open(), event.currentTarget)
                : item.run?.()
            }
          >
            {item.label}
          </button>
        ))}
        {more.length > 0 && (
          <button
            aria-haspopup="menu"
            onClick={(event) =>
              actions.openItems(
                text.library.more,
                more.map(({ item }) => item),
                event.currentTarget,
              )
            }
          >
            {text.library.more}
          </button>
        )}
      </div>
      <button onClick={() => onChange(selectAll?.() ?? allTableRows(selection.checkboxes))}>
        {text.library.selectAll}
      </button>
      <button className="accent" onClick={onDone}>
        {text.library.done}
      </button>
    </div>
  );
}
