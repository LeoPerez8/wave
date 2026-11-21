/**
 * Song rows dragged onto a sidebar playlist, the Queue panel or the player bar's Queue button,
 * with the browser's own drag and drop, as the Queue and Downloads move their rows. What a drag
 * carries stays here while it lasts: the page can't read a drag's data before the drop, and a
 * Select All target doesn't fit in it. The drag's data says only that songs are coming.
 */
import { useState, type DragEvent } from "react";

import type { BrowseRow } from "../../shared/browse.ts";
import type { SelectionTarget } from "../../shared/collectionActions.ts";
import type { SongTarget } from "../../shared/songActions.ts";

/** What a drag of song rows brings: Library songs, a mixed selection, or a streamed song. */
export type DraggedSongs =
  | { readonly kind: "songs"; readonly target: SongTarget }
  | { readonly kind: "selection"; readonly target: SelectionTarget }
  | { readonly kind: "streamed"; readonly videoId: string };

/**
 * What a YouTube Music page's or Related's song row carries: a streamed song, or a Library
 * song as its menu has it. A file outside the Library has none.
 */
export const listRowDrag = (row: BrowseRow): DraggedSongs | null =>
  row.outside
    ? null
    : row.videoId !== undefined
      ? { kind: "streamed", videoId: row.videoId }
      : { kind: "songs", target: { scope: { kind: "songs" }, ids: [row.id] } };

/** The drag data's type, which a drop target can see while the drag is over it. */
const SONGS = "application/x-wave-songs";

let dragged: DraggedSongs | undefined;

/** The songs a drag over a target brings; none for another drag (a file, a Queue row). */
export const draggedSongs = (event: DragEvent): DraggedSongs | undefined =>
  event.dataTransfer.types.includes(SONGS) ? dragged : undefined;

/** Makes a row draggable; [songs] says what it carries, read when the drag starts. */
export const songDragProps = (songs: () => DraggedSongs | null) => ({
  draggable: true,
  onDragStart: (event: DragEvent) => {
    const what = songs();
    if (what === null) {
      event.preventDefault();
      return;
    }
    dragged = what;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(SONGS, "songs");
  },
  onDragEnd: () => {
    dragged = undefined;
  },
});

/**
 * Drop targets for dragged songs, told apart by a key: [over] is the one a drag it can take is
 * over, for its highlight. `props(key, onDrop, takes)` gives a target its events; [onDrop] gets
 * the songs, and [takes] false turns drags away (a History row of the Queue).
 */
export function useSongDrop<K>() {
  const [over, setOver] = useState<K>();
  const leave = (key: K) => setOver((current) => (current === key ? undefined : current));
  const props = (
    key: K,
    onDrop: (songs: DraggedSongs, event: DragEvent) => void,
    takes = true,
  ) => ({
    onDragOver: (event: DragEvent) => {
      if (!takes || draggedSongs(event) === undefined) return leave(key);
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setOver(key);
    },
    onDragLeave: (event: DragEvent) => {
      const into = event.relatedTarget;
      if (!(into instanceof Node) || !event.currentTarget.contains(into)) leave(key);
    },
    onDrop: (event: DragEvent) => {
      leave(key);
      const songs = draggedSongs(event);
      if (songs === undefined || !takes) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = undefined;
      onDrop(songs, event);
    },
  });
  return { over, props };
}
