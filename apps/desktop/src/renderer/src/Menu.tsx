import { desktopKey } from "@wave/core";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { pressOf } from "./keys.ts";

export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

/** A button's context menu opens at the pointer or just below the focused button. */
export const itemMenuEvents = (open: (at: MenuPoint) => void) => ({
  onContextMenu: (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.focus();
    open({ x: event.clientX, y: event.clientY });
  },
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (desktopKey(pressOf(event), "list") !== "songMenu") return;
    event.preventDefault();
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    open({ x: left, y: bottom });
  },
});

export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** A line under the label saying what the entry does. */
  readonly line?: string;
  /** One of a set of choices: whether it is the chosen one, which shows a mark. */
  readonly checked?: boolean;
  /** Runs the entry once the menu has closed. */
  readonly run?: () => void;
  /** Opens a submenu in the menu's place, named [submenu]; ← or Esc goes back. */
  readonly open?: () => Promise<readonly MenuItem[]>;
  readonly submenu?: string;
}

/** A menu that's open: its name, its entries and where it shows. */
export interface OpenMenu {
  readonly label: string;
  readonly items: Promise<readonly MenuItem[]> | readonly MenuItem[];
  readonly at: { readonly x: number; readonly y: number };
}

interface Level {
  readonly label: string;
  readonly items: readonly MenuItem[];
}

/**
 * A popup menu at [at]: ↑/↓, Home and End move, Enter or Space chooses, → opens a submenu,
 * ← goes back, Esc closes. Focus goes back where it was when it closes.
 */
export function Menu({
  label,
  items,
  at,
  onClose,
}: {
  readonly label: string;
  readonly items: Promise<readonly MenuItem[]> | readonly MenuItem[];
  readonly at: { readonly x: number; readonly y: number };
  readonly onClose: () => void;
}) {
  const [levels, setLevels] = useState<readonly Level[]>(() =>
    Array.isArray(items) ? [{ label, items }] : [],
  );
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(at);
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const level = levels.at(-1);
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const element = opener.current;
      if (element instanceof HTMLElement && element.isConnected) element.focus();
    };
  }, []);
  useEffect(() => {
    if (Array.isArray(items)) return;
    let current = true;
    void Promise.resolve(items)
      .then((loaded) => {
        if (current) setLevels([{ label, items: loaded }]);
      })
      .catch(onClose);
    return () => {
      current = false;
    };
  }, [items, label, onClose]);
  useLayoutEffect(() => {
    const element = menu.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    setPlace({
      x: Math.max(8, Math.min(at.x, innerWidth - width - 8)),
      y: at.y + height > innerHeight - 8 ? Math.max(8, at.y - height) : at.y,
    });
  }, [at, levels]);
  useLayoutEffect(() => {
    menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [active, levels]);

  const enabled = (level?.items ?? [])
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const step = (by: number) => {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + by + enabled.length) % enabled.length]!);
  };
  const open = (item: MenuItem) => {
    void item
      .open?.()
      .then((loaded) => {
        setLevels((previous) => [
          ...previous,
          { label: item.submenu ?? item.label, items: loaded },
        ]);
        setActive(loaded.findIndex((entry) => !entry.disabled));
      })
      .catch(onClose);
  };
  const choose = (item: MenuItem | undefined) => {
    if (item === undefined || item.disabled) return;
    if (item.open !== undefined) open(item);
    else {
      onClose();
      item.run?.();
    }
  };
  const back = () => {
    if (levels.length <= 1) onClose();
    else {
      setLevels((previous) => previous.slice(0, -1));
      setActive(0);
    }
  };
  const key = (event: KeyboardEvent) => {
    const handled = (() => {
      switch (event.key) {
        case "ArrowDown":
          return step(1);
        case "ArrowUp":
          return step(-1);
        case "Home":
          return setActive(enabled[0] ?? 0);
        case "End":
          return setActive(enabled.at(-1) ?? 0);
        case "Enter":
        case " ":
          return choose(level?.items[active]);
        case "ArrowRight": {
          const item = level?.items[active];
          return item?.open === undefined ? undefined : open(item);
        }
        case "ArrowLeft":
        case "Escape":
          return back();
        case "Tab":
          return onClose();
        default:
          return false;
      }
    })();
    if (handled === false) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      className="menu-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {level && (
        <div
          ref={menu}
          className="menu"
          role="menu"
          aria-label={level.label}
          style={{ left: place.x, top: place.y }}
          onKeyDown={key}
        >
          {level.items.map((item, index) => (
            <button
              key={item.key}
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              data-index={index}
              tabIndex={index === active ? 0 : -1}
              aria-disabled={item.disabled || undefined}
              aria-haspopup={item.open === undefined ? undefined : "menu"}
              className={item.destructive ? "destructive" : undefined}
              onMouseEnter={() => item.disabled || setActive(index)}
              onClick={() => choose(item)}
            >
              {item.line === undefined ? (
                <span className="truncate">{item.label}</span>
              ) : (
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  <span className="menu-line block truncate">{item.line}</span>
                </span>
              )}
              {item.checked && <span aria-hidden="true">✓</span>}
              {item.open !== undefined && <span aria-hidden="true">›</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
