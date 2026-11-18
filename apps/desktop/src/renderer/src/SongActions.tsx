/**
 * A song's menu, the selection bar and what their entries do: the phone's entries (Core's
 * `desktopSongActions`, read through `window.wave.songs`) with the phone's toasts.
 */
import {
  actionBarLabel,
  confirmSongRemoval,
  describePlaylistAdd,
  favoriteToast,
  isDestructiveAction,
  queuedToast,
  splitActionBar,
  toastDuration,
  type ActionSurface,
  type AlertSpec,
  type ItemActionEntry,
} from "@wave/core";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import type { BrowseScope } from "../../shared/browse.ts";
import type { SongMenu, SongRunAction, SongTarget } from "../../shared/songActions.ts";
import { Menu, type MenuItem } from "./Menu.tsx";
import { language, text } from "./text.ts";

/** Checked songs: the ones in [ids], or with [all] every song of the list but those. */
export interface Selection {
  readonly all: boolean;
  readonly ids: ReadonlySet<number>;
}

export const isChecked = (selection: Selection, id: number): boolean =>
  selection.all !== selection.ids.has(id);

export const toggled = (selection: Selection, id: number): Selection => {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { all: selection.all, ids };
};

export const selectionTarget = (scope: BrowseScope, selection: Selection): SongTarget | null =>
  selection.all
    ? { scope, all: true, except: [...selection.ids] }
    : selection.ids.size === 0
      ? null
      : { scope, ids: [...selection.ids] };

type Route = { readonly kind: "album" | "artist"; readonly id: number };

interface Options {
  /** Opens an album's or an artist's page. */
  readonly go: (route: Route) => void;
  /** Turns selection on with [ids] checked. */
  readonly select: (ids: readonly number[]) => void;
  /** Says an action failed, in the window's error line. */
  readonly failed: (message?: string) => void;
  /** Reads the player and the rows again once an action changed them. */
  readonly changed: () => void;
}

interface Confirm {
  readonly spec: AlertSpec;
  readonly onAction: () => void;
}

/** The playlists Add to Playlist offers: the sidebar's first page. */
const playlists = async () =>
  (await window.wave.library.browse({ kind: "playlists" }, 0, 200)).items;

/** The menus, toasts and question an entry can show, and how to open them. */
export function useSongActions({ go, select, failed, changed }: Options) {
  const [menu, setMenu] = useState<{
    readonly label: string;
    readonly items: Promise<readonly MenuItem[]> | readonly MenuItem[];
    readonly at: { readonly x: number; readonly y: number };
  }>();
  const [toast, setToast] = useState<{ readonly message: string; readonly id: number }>();
  const [confirm, setConfirm] = useState<Confirm>();

  const notify = useCallback((message: string | null) => {
    if (message !== null) setToast({ message, id: Date.now() });
  }, []);

  const run = useCallback(
    async (target: SongTarget, action: SongRunAction, surface: ActionSurface, id?: number) => {
      try {
        const result = await window.wave.songs.run(target, action, id);
        changed();
        switch (result.kind) {
          case "queued":
            return notify(
              queuedToast(
                {
                  type: action === "playNext" ? "playNext" : "addToQueue",
                  trackIds: Array.from({ length: result.count }, (_, n) => String(n)),
                },
                undefined,
                text,
              ),
            );
          case "favorite":
            return notify(favoriteToast(surface, result.on, result.count, language));
          case "playlist":
            return notify(
              describePlaylistAdd(result.name, result.added, result.alreadyIn, language),
            );
          case "removed":
            return;
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
      entry: ItemActionEntry,
      target: SongTarget,
      about: SongMenu,
      surface: ActionSurface,
      finish: () => void,
    ): MenuItem => {
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
        case "unfavorite":
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
              return rows.length === 0
                ? [{ key: "none", label: text.desktopLibrary.noPlaylists, disabled: true }]
                : rows.map((row) => ({
                    key: `playlist-${row.id}`,
                    label: row.title,
                    run: () => {
                      finish();
                      void run(target, "addToPlaylist", surface, row.id);
                    },
                  }));
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
        default:
          // Copy Link, Magic Queue and Fix Song come with their features' tickets.
          return { ...base, disabled: true };
      }
    },
    [go, run, select],
  );

  /** Opens one song's menu at [at]. */
  const openMenu = useCallback(
    (target: SongTarget, title: string, at: { readonly x: number; readonly y: number }) =>
      setMenu({
        label: text.desktopLibrary.songMenu(title),
        at,
        items: window.wave.songs
          .actions(target, "menu")
          .then((about) =>
            about.entries.map((entry) => itemFor(entry, target, about, "menu", () => {})),
          ),
      }),
    [itemFor],
  );

  /** Opens a menu of [items] under [element] (the selection bar's More and submenus). */
  const openItems = useCallback(
    (
      label: string,
      items: Promise<readonly MenuItem[]> | readonly MenuItem[],
      element: Element,
    ) => {
      const rect = element.getBoundingClientRect();
      setMenu({ label, items, at: { x: rect.left, y: rect.bottom + 4 } });
    },
    [],
  );

  const closeMenu = useCallback(() => setMenu(undefined), []);
  const hideToast = useCallback(() => setToast(undefined), []);
  const overlays = (
    <>
      {menu && <Menu label={menu.label} items={menu.items} at={menu.at} onClose={closeMenu} />}
      {toast && <Toast key={toast.id} message={toast.message} onDone={hideToast} />}
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
    overlays,
    /** Closes the open menu, if one is; false when none was. */
    closeMenu: () => {
      if (menu === undefined) return false;
      setMenu(undefined);
      return true;
    },
  };
}

function Toast({ message, onDone }: { readonly message: string; readonly onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, toastDuration(message));
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="playback-toast action-toast" role="status">
      <span>{message}</span>
    </div>
  );
}

/** Keeps Tab inside [element]'s buttons. */
const trapTab = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "Tab") return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button")];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
};

/** Wave's alert: Cancel and the action, Cancel focused; Esc cancels. */
function ConfirmDialog({
  spec,
  onChoose,
}: {
  readonly spec: AlertSpec;
  readonly onChoose: (yes: boolean) => void;
}) {
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
          <button autoFocus onClick={() => onChoose(false)}>
            {text.alert.cancel}
          </button>
          <button
            className={spec.action?.destructive ? "destructive" : "accent"}
            onClick={() => onChoose(true)}
          >
            {spec.action?.label}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The selection bar: how many songs are checked, the phone's actions, Select All and Done. */
export function SelectionBar({
  scope,
  selection,
  revision,
  actions,
  onChange,
  onDone,
}: {
  readonly scope: BrowseScope;
  readonly selection: Selection;
  readonly revision: number;
  readonly actions: ReturnType<typeof useSongActions>;
  readonly onChange: (selection: Selection) => void;
  readonly onDone: () => void;
}) {
  const target = selectionTarget(scope, selection);
  const key = JSON.stringify(target);
  const [about, setAbout] = useState<{ readonly key: string; readonly menu: SongMenu }>();
  useEffect(() => {
    // The target is read again only when it or the rows change.
    const wanted = JSON.parse(key) as SongTarget | null;
    if (wanted === null) return;
    let current = true;
    void window.wave.songs
      .actions(wanted, "selection")
      .then((menu) => {
        if (current) setAbout({ key, menu });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [key, revision]);
  const menu = target !== null && about?.key === key ? about.menu : undefined;
  const items =
    menu === undefined || target === null
      ? []
      : menu.entries.map((entry) => ({
          entry,
          item: actions.itemFor(entry, target, menu, "selection", onDone),
        }));
  const { bar, more } = splitActionBar(
    items.map(({ entry, item }) => ({ action: entry.action, item })),
    5,
  );
  return (
    <div className="selection-bar" role="toolbar" aria-label={text.library.selectionActions}>
      <span className="selection-count" role="status">
        {text.library.selected(target === null ? 0 : (menu?.count ?? 0))}
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
      <button onClick={() => onChange({ all: true, ids: new Set() })}>
        {text.library.selectAll}
      </button>
      <button className="accent" onClick={onDone}>
        {text.library.done}
      </button>
    </div>
  );
}
