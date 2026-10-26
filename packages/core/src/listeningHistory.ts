/** What a play showed when it started, independent of Library membership. */
export interface PlaySnapshot {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artworkPath: string | null;
  readonly thumbPath: string | null;
}

/** A local calendar day of listening, with the newest plays first. */
export interface ListeningHistoryDay<T> {
  readonly key: string;
  readonly title: string;
  readonly plays: readonly T[];
}

// Comparing calendar dates avoids treating a daylight-saving day as 24 hours.
const calendarDay = (date: Date): number =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;

/** Groups history in the phone's timezone; [now] makes day headers deterministic. */
export const listeningHistoryDays = <T extends { readonly startedAt: number }>(
  plays: readonly T[],
  now = Date.now(),
): readonly ListeningHistoryDay<T>[] => {
  const today = new Date(now);
  const groups = new Map<number, { key: string; title: string; plays: T[] }>();
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  for (const play of [...plays].sort((a, b) => b.startedAt - a.startedAt)) {
    const date = new Date(play.startedAt);
    const day = calendarDay(date);
    let group = groups.get(day);
    if (group === undefined) {
      const age = calendarDay(today) - day;
      const title =
        age === 0
          ? "Today"
          : age === 1
            ? "Yesterday"
            : age > 1 && age < 7
              ? date.toLocaleDateString("en-US", { weekday: "long" })
              : date.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
                });
      group = { key: String(day), title, plays: [] };
      groups.set(day, group);
    }
    group.plays.push(play);
  }
  return [...groups.values()];
};
