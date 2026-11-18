import { DESKTOP_SHORTCUTS, shortcutKeys } from "@wave/core";
import { useEffect, useRef } from "react";
import { text } from "./text.ts";

/** Ctrl+/: every shortcut, in Core's order. The list can't be edited. */
export function ShortcutsSheet({ onClose }: { readonly onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
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
          // The sheet's one button keeps focus.
          if (event.key === "Tab") event.preventDefault();
        }}
      >
        <h2 id="shortcuts-title">{strings.title}</h2>
        <dl className="shortcut-list">
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
