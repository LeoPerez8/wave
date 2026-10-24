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
  magicCatalogCandidatesSteps,
  catalogSeen,
  mapSteps,
  type CatalogPage,
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
import { runSteps } from "../lib/stepped.ts";

/** What a refill did: the bytes it used, and whether it reached YouTube Music. */
export interface MagicRefill {
  readonly bytes: number;
  readonly reached: boolean;
  /** Radio pages received, including any completed before a timeout. */
  readonly pages: readonly CatalogPage[];
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
  /** The catalog from this batch's one recommendation snapshot. */
  readonly catalog: readonly CatalogSong[];
  readonly between: Effect.Effect<void>;
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

/** A batch's pick, with the songs its refill's radios brought (null when none ran). */
export type MagicCatalogReadPick = MagicCatalogPick & { readonly refilled: number | null };

/** [session]'s YouTube Music candidates for its next batch, as [deps] have them. */
export const magicCatalogRead = <R>(
  session: MagicSession,
  deps: MagicCatalogReadDeps<R>,
): Effect.Effect<MagicCatalogReadPick, never, R> =>
  Effect.gen(function* () {
    const { graph, profileOf, styleOf, taste, now, inLibrary } = deps;
    const engine = deps.engine === undefined ? {} : { engine: deps.engine };
    const pickFrom = (catalog: readonly CatalogSong[], playable?: (videoId: string) => boolean) =>
      runSteps(
        magicCatalogCandidatesSteps(
          session,
          { catalog, graph, profileOf, styleOf, taste, now },
          { inLibrary, ...engine, ...(playable === undefined ? {} : { playable }) },
        ),
        deps.between,
      );
    if (!deps.online) {
      const cached = yield* deps.cached;
      const offline = yield* pickFrom(deps.catalog, (videoId) => cached.has(videoId));
      return { ...offline, refilled: null };
    }
    const catalog = deps.catalog;
    const pick = yield* pickFrom(catalog);
    const { onMobileData, usedToday, tried } = deps;
    const run = { onMobileData, usedToday, now, tried };
    if (!magicRefillDue(session, { catalog, left: pick.left }, run)) return { ...pick, refilled: null };
    const { bytes, reached, pages } = yield* deps.refill;
    if (reached) tried.set(session.id, now);
    if (onMobileData) deps.usedOnMobile(bytes);
    // Extend only this batch's copy. Writes belong to the next snapshot ask;
    // no second Library, graph or catalog read can change this batch halfway through.
    const grown = new Map<string, CatalogSong>();
    yield* runSteps(
      mapSteps(catalog, (entry) => {
        grown.set(entry.song.videoId, entry);
      }),
      deps.between,
    );
    for (const page of pages) {
      yield* deps.between;
      const seen = catalogSeen(grown, page, now);
      yield* runSteps(
        mapSteps(seen, (entry) => {
          grown.set(entry.song.videoId, entry);
        }),
        deps.between,
      );
    }
    const entries = yield* runSteps(
      mapSteps(grown.values(), (entry) => entry),
      deps.between,
    );
    const refilled = pages.reduce((sum, page) => sum + page.songs.length, 0);
    return { ...(yield* pickFrom(entries)), refilled };
  });
