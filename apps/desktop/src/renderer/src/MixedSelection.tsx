/**
 * Albums, artists, genres and playlists checked together, or with songs: what is checked, and
 * the bar that acts on every song the checked items hold (`window.wave.collections`).
 */
import {
  actionBarLabel,
  splitActionBar,
  tagLookupsToast,
  tableSelectionOf,
  type CollectionKind,
  type TableSelection,
} from "@wave/core";
import { useEffect, useMemo, useState } from "react";
import type { BrowseScope } from "../../shared/browse.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import type {
  CollectionPick,
  CollectionTarget,
  SelectionMenu,
  SelectionRunAction,
  SelectionTarget,
} from "../../shared/collectionActions.ts";
import type { MenuItem } from "./Menu.tsx";
import { selectionTarget, type useSongActions } from "./SongActions.tsx";
import { playlistItems } from "./StreamedSongMenu.tsx";
import { songActionToast } from "./songActionToast.ts";
import { language, text } from "./text.ts";

/** The checked rows of each kind's list on one page. */
export type CollectionPicks = { readonly [K in CollectionKind]?: TableSelection };

const KINDS = ["album", "artist", "playlist", "genre"] as const satisfies readonly CollectionKind[];

/** Once one list shows checkboxes, every list of the page does. */
export const pickCheckboxes = (picks: CollectionPicks | undefined): boolean =>
  picks !== undefined && KINDS.some((kind) => picks[kind]?.checkboxes === true);

/** [picks] with [kind]'s rows set to [selection]; undefined once nothing is checked. */
export const withPick = (
  picks: CollectionPicks | undefined,
  kind: CollectionKind,
  selection: TableSelection | undefined,
  checkboxes = false,
): CollectionPicks | undefined => {
  const next = { ...picks, [kind]: selection };
  const shown = checkboxes || pickCheckboxes(next);
  const kept = KINDS.flatMap((each): [CollectionKind, TableSelection][] => {
    const picked = next[each];
    if (picked === undefined || (!picked.all && picked.ids.size === 0)) return [];
    return [[each, picked.checkboxes === shown ? picked : { ...picked, checkboxes: shown }]];
  });
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
};

/** [picks] with [target] checked too, as its menu's Select does. */
export const withCollection = (
  picks: CollectionPicks | undefined,
  { kind, id }: CollectionTarget,
): CollectionPicks | undefined => {
  const current = picks?.[kind];
  if (current?.all) {
    const ids = new Set(current.ids);
    ids.delete(id);
    return withPick(picks, kind, { ...current, ids }, true);
  }
  return withPick(picks, kind, tableSelectionOf([...(current?.ids ?? []), id], true), true);
};

/** [picks] as the bridge takes them; Select All checks the rows the page's Find [find] finds. */
const picked = (picks: CollectionPicks, find?: string): CollectionPick[] =>
  KINDS.flatMap((kind): CollectionPick[] => {
    const selection = picks[kind];
    if (selection === undefined) return [];
    const ids = [...selection.ids];
    return selection.all
      ? [{ kind, all: true, except: ids, ...(find === undefined ? {} : { find }) }]
      : [{ kind, ids }];
  });

/** The checked songs [songs] with [picks], as one selection's target. */
export const selectionWithPicks = (
  picks: CollectionPicks,
  songs: SongTarget | null,
): SelectionTarget => ({ ...(songs ? { songs } : {}), collections: picked(picks) });

/** The one collection checked on its own, which keeps its own bar. */
export const onlyCollection = (
  picks: CollectionPicks | undefined,
): CollectionTarget | undefined => {
  const [only, ...rest] = picks === undefined ? [] : picked(picks);
  if (only === undefined || rest.length > 0 || "all" in only || only.ids.length !== 1)
    return undefined;
  return { kind: only.kind, id: only.ids[0]! };
};

/** The songs checked on the page beside its collections. */
export interface PickedSongs {
  readonly scope: BrowseScope;
  readonly selection: TableSelection;
}

/** The bar for collections checked together or with songs: how many, the phone's shared actions, Done. */
export function MixedSelectionBar({
  picks,
  find,
  songs,
  revision,
  actions,
  changed,
  failed,
  done,
}: {
  readonly picks: CollectionPicks;
  /** The page's Find, when it narrows the list the collections are checked in. */
  readonly find?: string | undefined;
  readonly songs: PickedSongs | undefined;
  readonly revision: number;
  readonly actions: Pick<ReturnType<typeof useSongActions>, "notify" | "openItems">;
  readonly changed: () => void;
  readonly failed: () => void;
  readonly done: () => void;
}) {
  const scope = songs && JSON.stringify(songs.scope);
  const checked = songs?.selection;
  const target = useMemo<SelectionTarget>(() => {
    const listed =
      scope === undefined || checked === undefined
        ? null
        : selectionTarget(JSON.parse(scope) as BrowseScope, checked);
    return { ...(listed ? { songs: listed } : {}), collections: picked(picks, find) };
  }, [picks, find, scope, checked]);
  const [about, setAbout] = useState<{
    readonly target: SelectionTarget;
    readonly menu: SelectionMenu;
  }>();
  useEffect(() => {
    let current = true;
    void window.wave.collections
      .selectionActions(target)
      .then((menu) => {
        if (current) setAbout({ target, menu });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [target, revision]);
  const menu = about?.target === target ? about.menu : undefined;
  const known =
    (checked && !checked.all ? checked.ids.size : 0) +
    KINDS.reduce((sum, kind) => sum + (picks[kind]?.all ? 0 : (picks[kind]?.ids.size ?? 0)), 0);
  const count = menu?.count ?? known;
  if (!pickCheckboxes(picks) && checked?.checkboxes !== true && count < 2) return null;

  const run = async (action: SelectionRunAction, playlistId?: number) => {
    done();
    try {
      if (action === "fixSongs") actions.notify(text.fixSongs.progress);
      const result = await window.wave.collections.runSelection(target, action, playlistId);
      changed();
      if (result.kind === "downloaded") return;
      actions.notify(
        result.kind === "fixed"
          ? tagLookupsToast(result.results, result.stop, result.skipped, text)
          : songActionToast(
              result,
              action === "playNext",
              "selection",
              result.kind === "queued" ? result.count : 0,
            ),
      );
    } catch {
      failed();
    }
  };
  const { bar, more } = splitActionBar(
    (menu?.entries ?? []).flatMap(({ action }): { action: typeof action; item: MenuItem }[] => {
      const base = { key: action, label: actionBarLabel(action, language) };
      switch (action) {
        case "playNext":
        case "addToQueue":
        case "download":
        case "fixSongs":
          return [{ action, item: { ...base, run: () => void run(action) } }];
        case "addToPlaylist":
          return [
            {
              action,
              item: { ...base, open: () => playlistItems((id) => void run(action, id)) },
            },
          ];
        default:
          return [];
      }
    }),
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
            onClick={(event) =>
              item.open
                ? actions.openItems(item.label, item.open(), event.currentTarget)
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
      <button className="accent" onClick={done}>
        {text.library.done}
      </button>
    </div>
  );
}
