import { useState } from "react";
import type { DownloadsView } from "../../shared/downloads.ts";
import { useEverySecond } from "./useEverySecond.ts";

/**
 * Where downloads stand, for the sidebar's percentage and the Downloads page; read again each
 * second while the window shows. Undefined until main first answers.
 */
export function useDownloads(): DownloadsView | undefined {
  const [view, setView] = useState<DownloadsView>();
  useEverySecond(
    () => window.wave.downloads.view(),
    (next) =>
      setView((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next)),
  );
  return view;
}

/** The run's progress as the sidebar shows it, a whole percent; null with no run. */
export const downloadPercent = (view: DownloadsView | undefined): number | null =>
  view?.progress == null ? null : Math.floor(view.progress * 100);
