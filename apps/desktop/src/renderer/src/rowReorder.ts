/**
 * Rows a list arranges by dragging them into place (the Playlists list in Custom), with the
 * browser's own drag and drop. The drag carries a type of its own, so song drop targets (the
 * sidebar's playlists, the Queue) turn it away, and these rows turn song drags away.
 */
import { useState, type DragEvent } from "react";

const ROW = "application/x-wave-row";

/**
 * Drag events for the rows of a list: [move] gets the dragged row's key and the place (from 0)
 * of the row it was dropped on. [dragging] is the row being dragged, [over] the place a drop
 * would take, for their looks.
 */
export function useRowReorder<K>(move: (key: K, to: number) => void) {
  const [dragging, setDragging] = useState<K>();
  const [over, setOver] = useState<number>();
  const ours = (event: DragEvent) =>
    dragging !== undefined && event.dataTransfer.types.includes(ROW);
  const props = (key: K, index: number) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      setDragging(key);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(ROW, String(index));
    },
    onDragEnd: () => {
      setDragging(undefined);
      setOver(undefined);
    },
    onDragOver: (event: DragEvent) => {
      if (!ours(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(index);
    },
    onDragLeave: (event: DragEvent) => {
      const into = event.relatedTarget;
      if (!(into instanceof Node) || !event.currentTarget.contains(into))
        setOver((current) => (current === index ? undefined : current));
    },
    onDrop: (event: DragEvent) => {
      if (!ours(event)) return;
      event.preventDefault();
      const moved = dragging!;
      setDragging(undefined);
      setOver(undefined);
      move(moved, index);
    },
  });
  return { props, dragging, over };
}
