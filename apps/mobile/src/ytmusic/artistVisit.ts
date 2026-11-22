/**
 * One visit of a Library artist: their page and the Songs screen its See more
 * opens share one Online read and one Library | Online pick, so a change on
 * either screen shows on the other and YouTube Music is asked once for both
 * (docs/spec.md › Artist songs). The visit ends when the last of its screens
 * leaves; the artist's next visit starts with nothing picked.
 */
import type { YtPick } from "@wave/core";

import type { ArtistOpeningContext } from "./artistOpeningRead.ts";

/** What a visit asks of its read: `createArtistOpeningRead`'s lifecycle. */
interface VisitReader {
  readonly open: (name: string) => void;
  readonly close: () => void;
  readonly update: (context: ArtistOpeningContext) => void;
}

/** A screen holding the visit; releasing it is calling it. */
export type VisitHold = () => void;

export interface ArtistVisit<R extends VisitReader> {
  /** The visit's one read, which sees the visit while any of its screens is in sight. */
  readonly reader: R;
  /** Library | Online as picked on either screen this visit; null until one is. */
  readonly pick: () => YtPick | null;
  readonly setPick: (pick: YtPick) => void;
  /** Hears a new pick. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Holds the visit while a screen of it is mounted, in sight while [sight]
   * says so; the first opens the read and the last one leaving closes it.
   */
  readonly hold: (name: string, sight: () => boolean) => VisitHold;
  /**
   * A screen's context for the read: the read gets what any of the visit's
   * screens has (one still loading doesn't stop the other's request), with
   * the visit's pick.
   */
  readonly update: (holder: VisitHold, context: ArtistOpeningContext) => void;
}

/** Makes a visit's read, given whether any of the visit's screens is in sight. */
export type MakeVisitReader<R extends VisitReader> = (visible: () => boolean) => R;

/** The visits under way, one per artist key. */
export const createArtistVisits = <R extends VisitReader>() => {
  const visits = new Map<string, ArtistVisit<R>>();

  const start = (key: string, make: MakeVisitReader<R>): ArtistVisit<R> => {
    const sights = new Set<() => boolean>();
    const holds = new Set<VisitHold>();
    const contexts = new Map<VisitHold, ArtistOpeningContext>();
    const listeners = new Set<() => void>();
    let pick: YtPick | null = null;
    const reader = make(() => [...sights].some((sight) => sight()));
    const drive = () => {
      const all = [...contexts.values()];
      if (all.length === 0) return;
      const any = (field: "enabled" | "settled" | "contentReady" | "integrated" | "always") =>
        all.some((context) => context[field]);
      reader.update({
        enabled: any("enabled"),
        settled: any("settled"),
        contentReady: any("contentReady"),
        integrated: any("integrated"),
        always: any("always"),
        pick,
      });
    };
    const visit: ArtistVisit<R> = {
      reader,
      pick: () => pick,
      setPick: (next) => {
        pick = next;
        for (const listener of listeners) listener();
        drive();
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      hold: (name, sight) => {
        // A visit read during render and held again after its last screen left (a remount).
        if (!visits.has(key)) visits.set(key, visit);
        if (sights.size === 0) reader.open(name);
        // Each hold is its own, even for a sight passed twice.
        const seen = () => sight();
        sights.add(seen);
        const release: VisitHold = () => {
          if (!sights.delete(seen)) return;
          holds.delete(release);
          contexts.delete(release);
          if (sights.size > 0) {
            drive();
            return;
          }
          reader.close();
          pick = null;
          if (visits.get(key) === visit) visits.delete(key);
        };
        holds.add(release);
        return release;
      },
      update: (holder, context) => {
        // A screen that has left has no say.
        if (!holds.has(holder)) return;
        contexts.set(holder, context);
        drive();
      },
    };
    return visit;
  };

  return {
    /**
     * [key]'s visit under way, or a new one whose read [make] makes (rendering
     * reads it before an effect holds it).
     */
    visit: (key: string, make: MakeVisitReader<R>): ArtistVisit<R> => {
      const found = visits.get(key);
      if (found !== undefined) return found;
      const visit = start(key, make);
      visits.set(key, visit);
      return visit;
    },
  };
};
