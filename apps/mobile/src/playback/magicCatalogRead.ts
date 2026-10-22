/**
 * A Magic Queue batch's YouTube Music candidates (docs/spec.md, Magic
 * Queue): out of the candidate catalog by the engine (Core's
 * `magicCatalogCandidates`), with no request while it has enough; when the
 * session runs low, its radio artists' radios are read into the catalog
 * first, under the harvest's network policy (`magicRefillDue`: on Wi-Fi when
 * low, on mobile data only when none is left, within the harvest's day;
 * once in 12 hours a session).
 * Offline, only the songs the audio cache holds whole. Kept free of Expo so
 * it runs under plain Node tests; the app's is `magicQueueRadio.ts`.
 */
import {
  magicCatalogCandidates,
  magicRefillDue,
  type ArtistGraph,
  type CatalogSong,
  type GenreProfileOf,
  type StyleOf,
  type MagicCatalogPick,
  type MagicSession,
  type RecommendOptions,
  type TasteProfile,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

/** What a refill did: the bytes it used, and whether it reached YouTube Music. */
export interface MagicRefill {
  readonly bytes: number;
  readonly reached: boolean;
}

/** What a read ranks, and how it reaches the network and the audio cache. */
export interface MagicCatalogReadDeps<R> {
  /** Whether the phone is online (read once a batch). */
  readonly online: boolean;
  /** Whether the phone is on mobile data (read once a batch). */
  readonly onMobileData: boolean;
  /** The mobile data the harvest used today, in bytes: a refill counts in it. */
  readonly usedToday: number;
  readonly now: number;
  /** The candidate catalog as it stands: read again after a refill. */
  readonly catalog: Effect.Effect<readonly CatalogSong[], never, R>;
  readonly graph: ArtistGraph | null;
  readonly profileOf: GenreProfileOf;
  /** Every artist's style (the Library's): what Same genres and Close hold the candidates to. */
  readonly styleOf?: StyleOf;
  readonly taste: TasteProfile | null;
  /** Whether the Library has [song]. */
  readonly inLibrary: (song: YtSong) => boolean;
  /** The video ids the audio cache holds whole: what plays offline. */
  readonly cached: Effect.Effect<ReadonlySet<string>, never, R>;
  /**
   * Reads the session's radios into the catalog (their artists' genres
   * looked up); gives the bytes it used, and whether it reached YouTube
   * Music. Never fails.
   */
  readonly refill: Effect.Effect<MagicRefill, never, R>;
  /** Counts [bytes] of mobile data used (only called on mobile data). */
  readonly usedOnMobile: (bytes: number) => void;
  /**
   * When each session's refill was last tried, by session id: kept for the
   * launch, so a refill that reached YouTube Music but brought nothing (an
   * artist it doesn't have, an empty radio) isn't tried again for 12 hours;
   * one that didn't reach it (offline, say) is tried by the next batch.
   * Written here.
   */
  readonly tried: Map<string, number>;
  /** How the engine ranks (the Magic Queue section's sliders); absent: its defaults. */
  readonly engine?: Omit<RecommendOptions, "avoid">;
}

/** [session]'s YouTube Music candidates for its next batch, as [deps] have them. */
export const magicCatalogRead = <R>(
  session: MagicSession,
  deps: MagicCatalogReadDeps<R>,
): Effect.Effect<MagicCatalogPick, never, R> =>
  Effect.gen(function* () {
    const { graph, profileOf, styleOf, taste, now, inLibrary } = deps;
    const engine = deps.engine === undefined ? {} : { engine: deps.engine };
    const pickFrom = (catalog: readonly CatalogSong[], playable?: (videoId: string) => boolean) =>
      magicCatalogCandidates(
        session,
        { catalog, graph, profileOf, styleOf, taste, now },
        { inLibrary, ...engine, ...(playable === undefined ? {} : { playable }) },
      );
    if (!deps.online) {
      const cached = yield* deps.cached;
      return pickFrom(yield* deps.catalog, (videoId) => cached.has(videoId));
    }
    const catalog = yield* deps.catalog;
    const pick = pickFrom(catalog);
    const { onMobileData, usedToday, tried } = deps;
    const run = { onMobileData, usedToday, now, tried };
    if (!magicRefillDue(session, { catalog, left: pick.left }, run)) return pick;
    const { bytes, reached } = yield* deps.refill;
    if (reached) tried.set(session.id, now);
    if (onMobileData) deps.usedOnMobile(bytes);
    return pickFrom(yield* deps.catalog);
  });
