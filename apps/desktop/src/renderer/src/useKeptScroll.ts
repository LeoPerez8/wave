import { useLayoutEffect, useRef } from "react";

/** Where each history entry's page was scrolled to, kept while the entry is in the history. */
const kept = new WeakMap<object, number>();
/** What the person does to scroll; after it, the page's own growth no longer moves it back. */
const SCROLLING = ["wheel", "keydown", "pointerdown"] as const;

/**
 * Keeps the scroll of the page's scrolling `.content` for the history [entry], and gives it back
 * once the page is [ready] (its content read), so Back returns to the same place. Sections that
 * fill in later (Discover, followed artists) would move it, so it is given back again as the page
 * grows, until the person scrolls.
 */
export function useKeptScroll<T extends HTMLElement>(entry: object, ready: boolean) {
  const page = useRef<T>(null);
  useLayoutEffect(() => {
    const element = page.current;
    const scroller = element?.closest(".content");
    if (!ready || !element || !scroller) return;
    const top = kept.get(entry);
    let restoring = top !== undefined;
    const restore = () => {
      if (restoring) scroller.scrollTop = top!;
    };
    restore();
    const growth = new ResizeObserver(restore);
    growth.observe(element);
    const stop = () => {
      restoring = false;
    };
    const keep = () => {
      if (!restoring) kept.set(entry, scroller.scrollTop);
    };
    scroller.addEventListener("scroll", keep, { passive: true });
    for (const kind of SCROLLING) scroller.addEventListener(kind, stop, { passive: true });
    return () => {
      growth.disconnect();
      scroller.removeEventListener("scroll", keep);
      for (const kind of SCROLLING) scroller.removeEventListener(kind, stop);
    };
  }, [entry, ready]);
  return page;
}
