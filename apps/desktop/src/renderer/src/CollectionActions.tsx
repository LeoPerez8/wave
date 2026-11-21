import {
  actionBarLabel,
  splitActionBar,
  tagLookupsToast,
  type ItemAction,
  type MissingSongsDownloadAction,
} from "@wave/core";
import { useEffect, useState } from "react";
import type {
  CollectionMenu,
  CollectionRunAction,
  CollectionTarget,
} from "../../shared/collectionActions.ts";
import type { MenuItem } from "./Menu.tsx";
import type { useSongActions } from "./SongActions.tsx";
import { playlistItems } from "./StreamedSongMenu.tsx";
import { songActionToast } from "./songActionToast.ts";
import { language, text } from "./text.ts";

interface Options {
  readonly actions: Pick<ReturnType<typeof useSongActions>, "notify" | "openItems">;
  readonly play: (target: CollectionTarget, shuffle: boolean) => void;
  readonly goToArtist: (id: number) => void;
  readonly select: (target: CollectionTarget) => void;
  readonly newPlaylist: (target: CollectionTarget) => void;
  readonly playlistEdits: (id: number) => Promise<readonly MenuItem[]>;
  readonly changed: () => void;
  readonly failed: (message?: string) => void;
}

const downloadActions = {
  downloadMissingSongs: "downloadAll",
  retryFailed: "retryFailed",
  cancelDownload: "cancel",
} as const satisfies Partial<Record<ItemAction, MissingSongsDownloadAction>>;

export function collectionActions({
  actions,
  play,
  goToArtist,
  select,
  newPlaylist,
  playlistEdits,
  changed,
  failed,
}: Options) {
  const run = async (target: CollectionTarget, action: CollectionRunAction, id?: number) => {
    try {
      if (action === "fixSongs") actions.notify(text.fixSongs.progress);
      const result = await window.wave.collections.run(target, action, id);
      changed();
      actions.notify(
        result.kind === "fixed"
          ? tagLookupsToast(result.results, result.stop, result.skipped, text)
          : songActionToast(
              result,
              action === "playNext",
              "menu",
              result.kind === "queued" ? result.count : 0,
            ),
      );
    } catch {
      failed();
    }
  };

  const itemsFor = async (target: CollectionTarget, about: CollectionMenu): Promise<MenuItem[]> => {
    const edits = target.kind === "playlist" ? await playlistEdits(target.id) : [];
    // A collaborative playlist's menu opens with the line that says where it is edited.
    const items: MenuItem[] = edits.filter((item) => item.key === "collaborative");
    for (const action of about.play) {
      const runPlay =
        action === "play" || action === "shuffle"
          ? () => play(target, action === "shuffle")
          : () => void run(target, action);
      items.push({ key: action, label: text.itemActions.playLabels[action], run: runPlay });
    }
    for (const entry of about.entries) {
      const { action } = entry;
      if (items.some((item) => item.key === action)) continue;
      const base = { key: action, label: text.itemActions.labels[action] };
      switch (action) {
        case "playNext":
        case "addToQueue":
        case "fixSongs":
          items.push({ ...base, run: () => void run(target, action) });
          break;
        case "addToPlaylist":
          items.push({
            ...base,
            open: () =>
              playlistItems(
                (id) => void run(target, action, id),
                () => newPlaylist(target),
              ),
          });
          break;
        case "magicQueue":
          items.push({
            ...base,
            run: () => {
              const couldnt = () => failed(text.playbackText.couldntStartTheMagicQueue);
              void window.wave.magicQueue
                .start({ scope: target, all: true, except: [] })
                .then((started) => {
                  if (started) changed();
                  else couldnt();
                })
                .catch(couldnt);
            },
          });
          break;
        case "goToArtist": {
          if (!("artists" in entry)) break;
          const link = entry.artists;
          items.push(
            link.kind === "open"
              ? { ...base, run: () => goToArtist(link.artistId) }
              : {
                  ...base,
                  submenu: text.desktopLibrary.chooseArtist,
                  open: async () =>
                    about.artists
                      .filter((artist) => link.artistIds.includes(artist.id))
                      .map(({ id, name }) => ({
                        key: String(id),
                        label: name,
                        run: () => goToArtist(id),
                      })),
                },
          );
          break;
        }
        case "downloadMissingSongs":
        case "retryFailed":
        case "cancelDownload":
          if (target.kind === "album")
            items.push({
              ...base,
              run: () =>
                void window.wave.downloads
                  .missingAction(downloadActions[action], { kind: "album", id: target.id })
                  .catch(() => failed()),
            });
          break;
        case "select":
          items.push({ ...base, run: () => select(target) });
          break;
        case "share": {
          const graveyard = edits.find((item) => item.key === "graveyard");
          if (graveyard) items.push(graveyard);
          const copy = edits.find((item) => item.key === action);
          if (copy) items.push(copy);
          const spotify = edits.find((item) => item.key === "shareToSpotify");
          if (spotify) items.push(spotify);
          break;
        }
        case "renamePlaylist":
        case "changeImage":
        case "adjustImage":
        case "removeImage":
        case "deletePlaylist": {
          const edit = edits.find((item) => item.key === action);
          if (edit) items.push(edit);
          break;
        }
      }
    }
    return items;
  };
  return { itemsFor };
}

/** Select checks one collection and opens the same actions the selection planner offers. */
export function CollectionSelectionBar({
  target,
  here,
  itemsFor,
  openItems,
  done,
  failed,
}: {
  readonly target: CollectionTarget;
  readonly here: string;
  readonly itemsFor: ReturnType<typeof collectionActions>["itemsFor"];
  readonly openItems: Options["actions"]["openItems"];
  readonly done: () => void;
  readonly failed: () => void;
}) {
  const [about, setAbout] = useState<CollectionMenu>();
  const [items, setItems] = useState<MenuItem[]>([]);
  useEffect(() => {
    let current = true;
    void window.wave.collections
      .actions(target, { here, surface: "selection" })
      .then(async (loaded) => {
        const resolved = await itemsFor(target, loaded);
        if (current) {
          setAbout(loaded);
          setItems(resolved);
        }
      })
      .catch(() => current && failed());
    return () => {
      current = false;
    };
    // The selection bar mounts for this target and closes when an action runs.
  }, [target, here, itemsFor, failed]);
  const { bar, more } = splitActionBar(
    (about?.entries ?? []).flatMap(({ action }) => {
      const item = items.find((candidate) => candidate.key === action);
      if (item === undefined) return [];
      return [
        {
          action,
          item: {
            ...item,
            label: actionBarLabel(action, language),
            run:
              item.run &&
              (() => {
                done();
                item.run?.();
              }),
            open:
              item.open &&
              (async () =>
                (await item.open!()).map((child) => ({
                  ...child,
                  run:
                    child.run &&
                    (() => {
                      done();
                      child.run?.();
                    }),
                }))),
          },
        },
      ];
    }),
    5,
  );
  return (
    <div className="selection-bar" role="toolbar" aria-label={text.library.selectionActions}>
      <span className="selection-count" role="status">
        {text.library.selected(1)}
      </span>
      <div className="selection-actions">
        {bar.map(({ item }) => (
          <button
            key={item.key}
            onClick={(event) =>
              item.open
                ? openItems(item.submenu ?? item.label, item.open(), event.currentTarget)
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
              openItems(
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
      <button className="accent" onClick={done}>
        {text.library.done}
      </button>
    </div>
  );
}
