/**
 * The page DJ reads when a selected tile's row isn't full (docs/spec.md, DJ):
 * the artist's "Fans might also like" list, from what's saved for their page
 * when that's recent enough (Core's `djPageRead`), else asked for and saved.
 */
import { djPageRead, type DjPageRead, type DjSavedPage } from "@wave/core";

/** What reading a tile's page needs from the phone. */
export interface DjSimilarPorts<S extends DjSavedPage> {
  /** What's saved for the artist's page, or null. */
  readonly saved: () => Promise<S | null>;
  /** Whether YouTube Music can be asked now: it's on and the phone is online. */
  readonly canAsk: () => boolean;
  /** Asks YouTube Music for the page given what was saved, and saves the answer; rejects when it gets none. */
  readonly ask: (saved: S | null) => Promise<S>;
  readonly now: () => number;
}

/**
 * The similar artists the page of a tile lists, in the page's order: from
 * the saved answer with no request while it stands, otherwise from the page
 * read now. When that read can't be made or fails, an older saved list
 * stands; with none, null, and the row keeps what the artist graph gave.
 * It never rejects.
 */
export const readDjSimilar = async <S extends DjSavedPage>(
  ports: DjSimilarPorts<S>,
): Promise<DjPageRead["artists"]> => {
  const saved = await ports.saved().catch(() => null);
  const onPhone = djPageRead(saved, ports.now());
  if (!onPhone.ask || !ports.canAsk()) return onPhone.artists;
  try {
    return djPageRead(await ports.ask(saved), ports.now()).artists;
  } catch {
    return onPhone.artists;
  }
};
