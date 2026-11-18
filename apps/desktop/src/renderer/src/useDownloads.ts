import { useEffect, useState } from "react";
import type { DownloadsView } from "../../shared/downloads.ts";

/** How often the window asks main where downloads stand. */
const EVERY_MS = 1_000;

/**
 * Where downloads stand, for the sidebar's percentage and the Downloads page; read again each
 * second while the window shows. Undefined until main first answers.
 */
export function useDownloads(): DownloadsView | undefined {
  const [view, setView] = useState<DownloadsView>();
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!document.hidden) {
          const next = await window.wave.downloads.view();
          if (current)
            setView((previous) =>
              JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
            );
        }
      } catch {
        // Main answers again on the next read.
      } finally {
        if (current) timer = setTimeout(() => void poll(), EVERY_MS);
      }
    };
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, []);
  return view;
}

/** The run's progress as the sidebar shows it, a whole percent; null with no run. */
export const downloadPercent = (view: DownloadsView | undefined): number | null =>
  view?.progress == null ? null : Math.floor(view.progress * 100);
