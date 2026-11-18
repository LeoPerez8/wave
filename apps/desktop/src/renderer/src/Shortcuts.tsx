import { DESKTOP_SHORTCUTS, desktopKey, shortcutKeys } from "@wave/core";
import { useEffect, useRef } from "react";
import { pressOf } from "./keys.ts";
import { text } from "./text.ts";

/** Ctrl+/: every shortcut, in Core's order. The list can't be edited. */
export function ShortcutsSheet({ onClose }: { readonly onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDListElement>(null);
  const strings = text.desktopShortcuts;
  useEffect(() => {
    const opener = document.activeElement;
    close.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog shortcuts-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onKeyDown={(event) => {
          const command = desktopKey(pressOf(event), "other");
          // Esc and Ctrl+/ close the sheet; the other keys scroll the list, not the player.
          if (command === "close" || command === "shortcuts") return;
          event.stopPropagation();
          if (event.key !== "Tab") return;
          // Tab moves between the list and Close.
          event.preventDefault();
          (document.activeElement === close.current ? list.current : close.current)?.focus();
        }}
      >
        <h2 id="shortcuts-title">{strings.title}</h2>
        <dl ref={list} className="shortcut-list" tabIndex={0} aria-labelledby="shortcuts-title">
          {DESKTOP_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.id} className="shortcut-row">
              <dt>{strings.labels[shortcut.id]}</dt>
              <dd>
                {shortcutKeys(shortcut, strings.keys).map((combo) => (
                  <kbd key={combo}>{combo}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="dialog-buttons">
          <button ref={close} className="accent" onClick={onClose}>
            {strings.close}
          </button>
        </div>
      </div>
    </div>
  );
}
