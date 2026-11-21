import { listeningHistoryDays, type AppLanguage } from "@wave/core";

export const HISTORY_DAY_HEIGHT = 44;
export const HISTORY_ROW_HEIGHT = 40;
const OVERSCAN = 5;

/** A line of the history table: a day's header or a play, [top] pixels down. */
export type HistoryItem<T> =
  | { readonly kind: "day"; readonly key: string; readonly title: string; readonly top: number }
  | { readonly kind: "play"; readonly key: string; readonly play: T; readonly top: number };

/** [plays] under Core's day headers, each line with its offset, and the height of them all. */
export const historyItems = <T extends { readonly id: number; readonly startedAt: number }>(
  plays: readonly T[],
  now: number,
  language: AppLanguage,
): { readonly items: readonly HistoryItem<T>[]; readonly height: number } => {
  const items: HistoryItem<T>[] = [];
  let top = 0;
  for (const day of listeningHistoryDays(plays, now, language)) {
    items.push({ kind: "day", key: `day:${day.key}`, title: day.title, top });
    top += HISTORY_DAY_HEIGHT;
    for (const play of day.plays) {
      items.push({ kind: "play", key: `play:${play.id}`, play, top });
      top += HISTORY_ROW_HEIGHT;
    }
  }
  return { items, height: top };
};

/** The lines to draw for a viewport [height] tall scrolled to [top]: those in view and a few around. */
export const historyWindow = (
  items: readonly { readonly top: number }[],
  top: number,
  height: number,
): { readonly start: number; readonly end: number } => {
  // The last line starting at or above [edge].
  const lineAt = (edge: number) => {
    let low = 0;
    let high = items.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (items[middle]!.top <= edge) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  if (items.length === 0) return { start: 0, end: 0 };
  return {
    start: Math.max(0, lineAt(top) - OVERSCAN),
    end: Math.min(items.length, lineAt(top + height - 1) + 1 + OVERSCAN),
  };
};
