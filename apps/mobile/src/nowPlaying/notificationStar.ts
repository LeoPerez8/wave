import { parseTrackId } from "@wave/core";
import type {
  PlayingSongAnswer,
  PlayingSongTarget,
  createNowPlayingSongLookup,
} from "./songLookup.ts";

const sameTarget = (a: PlayingSongTarget | null, b: PlayingSongTarget | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.trackId === b.trackId && a.song?.videoId === b.song?.videoId);

/**
 * The Favorite button on the media notification (and Android Auto, which shares its buttons):
 * the playing song's star, filled for a favorite, and a tap that toggles it as Now Playing's
 * star does. A Library song's star comes from the stars in memory; a YT Music song's needs
 * its answer (the Library song it is by now), so only a YT Music song is read. With no song
 * to star, or while its star isn't known yet, the star is an outline and a tap does nothing.
 */
export const createNotificationStar = (ports: {
  /** A lookup of its own, so following the playing song leaves Now Playing's alone. */
  readonly lookup: Pick<ReturnType<typeof createNowPlayingSongLookup>, "update" | "get">;
  /** Whether [target] shows starred, its answer read or not; null while that isn't known yet. */
  readonly starred: (
    target: PlayingSongTarget,
    answer: PlayingSongAnswer | undefined,
  ) => boolean | null;
  /** Shows the star on the notification's button. */
  readonly show: (starred: boolean) => void;
  /** Toggles [target]'s star. */
  readonly star: (target: PlayingSongTarget) => Promise<void>;
}) => {
  let target: PlayingSongTarget | null = null;
  let followed = false;
  let shown: boolean | null = null;
  const starred = (): boolean | null =>
    target === null ? null : ports.starred(target, ports.lookup.get(target));
  const refresh = (): void => {
    const on = starred() === true;
    if (on === shown) return;
    shown = on;
    ports.show(on);
  };
  return {
    /** Follows the playing song (`playingSongTarget`). */
    follow(next: PlayingSongTarget | null): void {
      if (followed && sameTarget(next, target)) return;
      followed = true;
      target = next;
      ports.lookup.update(
        next !== null && parseTrackId(next.trackId)?.kind === "yt" ? next : null,
        true,
        true,
      );
      refresh();
    },
    /** Shows the star again, after the stars or the song's answer changed. */
    refresh,
    /** A tap on the button. */
    tap: (): Promise<void> =>
      target === null || starred() === null ? Promise.resolve() : ports.star(target),
  };
};
