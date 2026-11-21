import { useLayoutEffect, useRef } from "react";

/** Where each history entry's page was scrolled to, kept while the entry is in the history. */
const kept = new WeakMap<object, number>();

/**
 * Keeps the scroll of the page's scrolling `.content` for the history [entry], and gives it back
 * once the page is [ready] (its content read), so Back returns to the same place.
 */
export function useKeptScroll<T extends HTMLElement>(entry: object, ready: boolean) {
  const page = useRef<T>(null);
  useLayoutEffect(() => {
    const scroller = page.current?.closest(".content");
    if (!scroller) return;
    const keep = () => kept.set(entry, scroller.scrollTop);
    scroller.addEventListener("scroll", keep, { passive: true });
    return () => scroller.removeEventListener("scroll", keep);
  }, [entry]);
  useLayoutEffect(() => {
    const scroller = page.current?.closest(".content");
    const top = kept.get(entry);
    if (ready && scroller && top !== undefined) scroller.scrollTop = top;
  }, [entry, ready]);
  return page;
}
