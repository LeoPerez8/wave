import {
  allTableRows,
  extendTableRange,
  tableRange,
  tableSelectionOf,
  toggleTableRow,
  type DesktopCommand,
  type TableSelection,
} from "@wave/core";
import { useLayoutEffect, useRef, useState } from "react";

export interface TableSelectionProps {
  readonly selection?: TableSelection | undefined;
  readonly onSelection?: ((selection: TableSelection | undefined) => void) | undefined;
}

/** Keyboard and mouse selection for one ordered table. Its reader can fetch off-screen keys. */
export function useTableSelection({
  selection,
  onSelection,
  total,
  order,
  revision,
  read,
  selectAll,
  onError,
}: TableSelectionProps & {
  readonly total: number;
  readonly order: unknown;
  readonly revision: number;
  readonly read: (
    start: number,
    end: number,
    signal: AbortSignal,
  ) => Iterable<number> | Promise<Iterable<number>>;
  readonly selectAll?: () => TableSelection;
  readonly onError: () => void;
}) {
  const clicked = useRef<number>(undefined);
  const [ordinary, setOrdinary] = useState<number>();
  const keyboardAnchor = useRef<number>(undefined);
  const pending = useRef<AbortController>(undefined);
  /** The selection this table last asked for, so its arrival doesn't cancel a newer range. */
  const asked = useRef<TableSelection | undefined>(undefined);
  const cancel = () => {
    pending.current?.abort();
    pending.current = undefined;
  };
  const ask = (next: TableSelection | undefined) => {
    asked.current = next;
    onSelection?.(next);
  };
  useLayoutEffect(() => {
    clicked.current = undefined;
    keyboardAnchor.current = undefined;
  }, [order]);
  useLayoutEffect(() => cancel, [order, revision]);
  // A selection made elsewhere (Escape, Done, another list) cancels a range still being read.
  // The one this table asked for doesn't: a Shift+arrow pressed before it arrived is newer.
  useLayoutEffect(() => {
    const ours =
      selection !== undefined &&
      asked.current !== undefined &&
      selection.ids === asked.current.ids &&
      selection.all === asked.current.all;
    if (!ours) cancel();
  }, [selection]);
  useLayoutEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancel();
      clicked.current = undefined;
      keyboardAnchor.current = undefined;
      setOrdinary(undefined);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, []);

  const range = async (anchor: number, end: number) => {
    if (onSelection === undefined) return;
    cancel();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const window = tableRange(anchor, end);
      const ids = await read(window.start, window.end, controller.signal);
      if (!controller.signal.aborted) ask(tableSelectionOf(ids, selection?.checkboxes));
    } catch {
      if (!controller.signal.aborted) onError();
    } finally {
      if (pending.current === controller) pending.current = undefined;
    }
  };
  const toggle = (id: number) => {
    const next = toggleTableRow(selection, id, ordinary);
    setOrdinary(undefined);
    ask((next.all ? total - next.ids.size : next.ids.size) > 0 ? next : undefined);
  };
  return {
    ordinary,
    point: (id: number) => {
      if (selection === undefined) setOrdinary(id);
    },
    click(
      index: number,
      id: number,
      event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
    ) {
      if (onSelection === undefined) return setOrdinary(id);
      keyboardAnchor.current = undefined;
      if (event.shiftKey) {
        setOrdinary(undefined);
        void range(clicked.current ?? index, index);
        return;
      }
      cancel();
      if (event.ctrlKey || event.metaKey || selection?.checkboxes) toggle(id);
      else {
        if (selection !== undefined) ask(undefined);
        setOrdinary(id);
      }
      clicked.current = index;
    },
    key(command: DesktopCommand, active: number, move: (index: number) => void) {
      if (onSelection === undefined) return false;
      if (command === "extendUp" || command === "extendDown") {
        const extension = extendTableRange(
          keyboardAnchor.current,
          active,
          total,
          command === "extendDown" ? 1 : -1,
        );
        if (extension === null) return false;
        const { anchor, focus } = extension;
        keyboardAnchor.current = anchor;
        setOrdinary(undefined);
        move(focus);
        void range(anchor, focus);
        return true;
      }
      if (total === 0) return false;
      keyboardAnchor.current = undefined;
      if (command === "selectAllRows") {
        cancel();
        setOrdinary(undefined);
        ask(selectAll?.() ?? allTableRows(selection?.checkboxes));
        return true;
      }
      return false;
    },
    toggle,
  };
}
