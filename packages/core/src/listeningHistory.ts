import { createPlaylistFinder } from "./findInPlaylist.ts";
import { formatDate } from "./formatting.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";

/** What a play showed when it started, independent of Library membership. */
export interface PlaySnapshot {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artworkPath: string | null;
  readonly thumbPath: string | null;
  /** Original remote cover for a streamed play; local paths remain null. */
  readonly artworkUrl?: string | null;
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

// Portuguese writes weekdays and months in lower case; a header starts with a capital.
const header = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Groups history in the phone's timezone, headed in [language]; [now] makes day headers deterministic. */
export const listeningHistoryDays = <T extends { readonly startedAt: number }>(
  plays: readonly T[],
  now = Date.now(),
  language: AppLanguage = "en",
): readonly ListeningHistoryDay<T>[] => {
  const today = new Date(now);
  const strings = catalogueOf(language).listeningHistory;
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
          ? strings.today
          : age === 1
            ? strings.yesterday
            : age > 1 && age < 7
              ? header(formatDate(language, date, { weekday: "long" }))
              : header(
                  formatDate(language, date, {
                    month: "long",
                    day: "numeric",
                    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
                  }),
                );
      group = { key: String(day), title, plays: [] };
      groups.set(day, group);
    }
    group.plays.push(play);
  }
  return [...groups.values()];
};

/** Search matching over saved metadata; plays retain their supplied chronological order. */
export const findListeningHistory = <T extends { readonly snapshot: PlaySnapshot }>(
  plays: readonly T[],
  query: string,
): readonly T[] => {
  const found = createPlaylistFinder(plays, (play) => play.snapshot).find(query);
  return found === null ? plays : found.map((index) => plays[index]!);
};

/** What a history row does now and how it shows. */
export interface ListeningHistoryRowState {
  /** What activating the row plays: its Library song, its stream, or nothing. */
  readonly replays: "library" | "stream" | null;
  /** Its Library song has no file yet: shown as a missing song is elsewhere. */
  readonly missing: boolean;
  /** Dimmed: the song left the Library and no stream can play. */
  readonly unavailable: boolean;
  /** Nothing to play or to open a menu for. */
  readonly disabled: boolean;
}

/**
 * A play replays its Library song, else its stream while YT Music is on and
 * YouTube hasn't refused that video ([refused], known this session).
 */
export const listeningHistoryRowState = (
  play: {
    readonly song: { readonly path: string | null } | null;
    readonly streamedSong: { readonly videoId: string } | null;
  },
  ytMusic: boolean,
  refused: ReadonlySet<string>,
): ListeningHistoryRowState => {
  const { song, streamedSong } = play;
  const streams = streamedSong !== null && ytMusic && !refused.has(streamedSong.videoId);
  return {
    replays: song !== null ? "library" : streams ? "stream" : null,
    missing: song !== null && song.path === null,
    unavailable: song === null && !streams,
    disabled: song === null && streamedSong === null,
  };
};
