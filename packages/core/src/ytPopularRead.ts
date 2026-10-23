import { identityKey } from "./library.ts";
import { searchRoomAt, type SearchAllowance } from "./searchAllowance.ts";
import { ytArtistQuery, type YtArtistSaved } from "./ytArtist.ts";

export interface YtPopularReadContext {
  readonly name: string;
  readonly enabled: boolean;
  readonly onlineSelected: boolean;
  readonly online: boolean;
  readonly settled: boolean;
  readonly contentReady: boolean;
  readonly saved: YtArtistSaved | null;
  /** Artist identity keys already requested in this page opening. */
  readonly asked: ReadonlySet<string>;
  readonly allowance: SearchAllowance;
  readonly now: number;
}

/** Popular shares Online's read; it never asks while Library is selected. */
export const ytPopularReadDue = (context: YtPopularReadContext): boolean =>
  context.enabled &&
  context.onlineSelected &&
  context.online &&
  context.settled &&
  context.contentReady &&
  ytArtistQuery(context.name) !== null &&
  !context.asked.has(identityKey(context.name)) &&
  (context.saved === null ||
    (context.saved.outcome === "found" && context.saved.page.allSongs === undefined)) &&
  searchRoomAt(context.allowance, "search", context.now) === null;
