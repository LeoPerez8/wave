/**
 * The desktop's keyboard (docs/spec-desktop.md, Keyboard): which command a key press runs,
 * given what has focus, and the fixed list Ctrl+/ shows. Space and ↑/↓ are scoped: Space
 * plays or pauses unless a button, link, switch or field has focus, and ↑/↓ move between rows
 * in a list and change the volume elsewhere.
 */

/** A key press, as the window reads it (`KeyboardEvent.key` and its modifiers). */
export interface DesktopKeyPress {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/**
 * What has focus: a text field, a slider (the scrubber, the volume), a control that Space
 * presses (a button, link, switch or checkbox), a list (a table, the queue), or anything else.
 */
export type DesktopFocus = "field" | "slider" | "control" | "list" | "other";

export type DesktopCommand =
  | "playPause"
  | "next"
  | "previous"
  | "favorite"
  | "search"
  | "back"
  | "forward"
  | "rescan"
  | "close"
  | "quit"
  | "shortcuts"
  | "volumeUp"
  | "volumeDown"
  | "rowUp"
  | "rowDown"
  | "firstRow"
  | "lastRow"
  | "pageUp"
  | "pageDown"
  | "playRow"
  | "jump"
  | "songMenu"
  | "extendUp"
  | "extendDown"
  | "selectAllRows";

/** A list's keys, for the list that has focus. */
const listKey = ({ key, ctrl, alt, shift }: DesktopKeyPress): DesktopCommand | undefined => {
  if (key === "ContextMenu" || (shift && key === "F10")) return "songMenu";
  if (!alt && ctrl && !shift && key.toLowerCase() === "a") return "selectAllRows";
  if (!alt && !ctrl && shift) {
    if (key === "ArrowUp") return "extendUp";
    if (key === "ArrowDown") return "extendDown";
  }
  if (ctrl || alt || shift) return undefined;
  switch (key) {
    case "ArrowUp":
      return "rowUp";
    case "ArrowDown":
      return "rowDown";
    case "Home":
      return "firstRow";
    case "End":
      return "lastRow";
    case "PageUp":
      return "pageUp";
    case "PageDown":
      return "pageDown";
    case "Enter":
      return "playRow";
  }
  return /^[a-z0-9]$/i.test(key) ? "jump" : undefined;
};

/** The command [press] runs while [focus] has focus, or undefined to leave the key alone. */
export const desktopKey = (
  press: DesktopKeyPress,
  focus: DesktopFocus,
): DesktopCommand | undefined => {
  const { ctrl, alt, shift } = press;
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;
  if (key === "Escape" && !ctrl && !alt) return "close";
  if (key === "F5" && !ctrl && !alt) return "rescan";
  if (alt && !ctrl && !shift && key === "ArrowLeft") return "back";
  if (alt && !ctrl && !shift && key === "ArrowRight") return "forward";
  if (ctrl && !alt && !shift)
    switch (key) {
      case "q":
        return "quit";
      case "/":
        return "shortcuts";
      case "f":
        return "search";
      case "l":
        return "favorite";
      // A field moves its caret by words.
      case "ArrowRight":
        return focus === "field" ? undefined : "next";
      case "ArrowLeft":
        return focus === "field" ? undefined : "previous";
    }
  if (focus === "list") {
    const command = listKey(press);
    if (command !== undefined) return command;
  }
  if (ctrl || alt || shift) return undefined;
  if (key === " ") return focus === "field" || focus === "control" ? undefined : "playPause";
  if (focus === "field" || focus === "slider") return undefined;
  if (key === "ArrowUp") return "volumeUp";
  if (key === "ArrowDown") return "volumeDown";
  return undefined;
};

/** A key as the list names it: words come from the catalogue, the rest show as they are. */
export type ShortcutKey =
  | "ctrl"
  | "alt"
  | "shift"
  | "space"
  | "enter"
  | "esc"
  | "menu"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown"
  | "up"
  | "down"
  | "left"
  | "right"
  | "letters"
  | "f5"
  | "f10"
  | "slash"
  | "f"
  | "l"
  | "q"
  | "a"
  | "click";

/** One line of the list: what it does, and the key combinations that do it. */
export type ShortcutId =
  | Exclude<DesktopCommand, "volumeUp" | "volumeDown" | "extendUp" | "extendDown">
  | "volume"
  | "toggleRowSelection"
  | "selectRowRange"
  | "extendRowSelection";

export interface DesktopShortcut {
  readonly id: ShortcutId;
  readonly keys: readonly (readonly ShortcutKey[])[];
}

/** Every shortcut, in the order Ctrl+/ lists them. The list can't be edited. */
export const DESKTOP_SHORTCUTS: readonly DesktopShortcut[] = [
  { id: "playPause", keys: [["space"]] },
  { id: "next", keys: [["ctrl", "right"]] },
  { id: "previous", keys: [["ctrl", "left"]] },
  { id: "favorite", keys: [["ctrl", "l"]] },
  { id: "volume", keys: [["up"], ["down"]] },
  { id: "search", keys: [["ctrl", "f"]] },
  { id: "back", keys: [["alt", "left"]] },
  { id: "forward", keys: [["alt", "right"]] },
  { id: "playRow", keys: [["enter"]] },
  { id: "rowUp", keys: [["up"]] },
  { id: "rowDown", keys: [["down"]] },
  { id: "firstRow", keys: [["home"]] },
  { id: "lastRow", keys: [["end"]] },
  { id: "pageUp", keys: [["pageUp"]] },
  { id: "pageDown", keys: [["pageDown"]] },
  { id: "jump", keys: [["letters"]] },
  { id: "songMenu", keys: [["shift", "f10"], ["menu"]] },
  { id: "rescan", keys: [["f5"]] },
  { id: "close", keys: [["esc"]] },
  { id: "shortcuts", keys: [["ctrl", "slash"]] },
  { id: "quit", keys: [["ctrl", "q"]] },
  { id: "toggleRowSelection", keys: [["ctrl", "click"]] },
  { id: "selectRowRange", keys: [["shift", "click"]] },
  {
    id: "extendRowSelection",
    keys: [
      ["shift", "up"],
      ["shift", "down"],
    ],
  },
  { id: "selectAllRows", keys: [["ctrl", "a"]] },
];

/** [shortcut]'s key combinations as the list shows them ("Ctrl+→"), with [names] for each key. */
export const shortcutKeys = (
  shortcut: DesktopShortcut,
  names: { readonly [K in ShortcutKey]: string },
): string[] => shortcut.keys.map((combo) => combo.map((key) => names[key]).join("+"));
