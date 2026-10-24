/**
 * A Magic Queue's YouTube Music candidates from the candidate catalog
 * (docs/spec.md, Magic Queue): the engine (`recommend`) ranks the catalog
 * for the session's seed (its radio artists and the seed songs' genre
 * profile), the session's signals and the owner's taste on top, and a batch
 * picks from the best of them (`magicBatch`), with no request. The network
 * is only for a refill: when the session's candidates run low, the seed's
 * radio is read again, under the harvest's network policy.
 */

import type { CatalogSong } from "./candidateCatalog.ts";
import type { CatalogMixSong } from "./catalogMixes.ts";
import { mixRecordingOf } from "./discoverMixes.ts";
import { catalogRadiosReadAt, harvestNext, type HarvestRun } from "./harvest.ts";
import {
  magicArtistKey,
  magicGenreMatches,
  magicSeedProfile,
  magicSessionWeight,
  magicStyleMatches,
  magicYtSong,
  type MagicSession,
  type MagicYtCandidate,
} from "./magicQueue.ts";
import {
  recommendCandidatesSteps,
  rankRecommendedSteps,
  type RecommendOptions,
  type RecommendSources,
} from "./recommend.ts";
import { finishSteps, mapSteps, sortSteps } from "./buildSteps.ts";
import { GENRE_AFFINITY_THRESHOLD } from "./genreAffinity.ts";
import { ytTrackId, type YtSong } from "./ytMusic.ts";

/**
 * How many of a session's catalog candidates, the best first, a batch picks
 * its YouTube Music songs from: about what two pages of the seed's radio
 * gave, so the engine's ranking keeps the batch close to the seed.
 */
export const MAGIC_CATALOG_POOL = 50;

/** A Magic Queue's YouTube Music candidate out of the catalog. */
export type MagicCatalogCandidate = MagicYtCandidate<CatalogMixSong>;

/**
 * What the session's signals add to a catalog song's engine score: a
 * quarter of the binary log of their weight (`magicSessionWeight`), as the
 * engine weighs taste, so a liked artist's songs (or the seed's) come among
 * the best and an unknown one's stay as the engine ranked them.
 */
const SESSION_SIGNAL = 0.25;

/** What decides a session's catalog candidates besides the engine's sources. */
export interface MagicCatalogOptions {
  /** Whether the Library has [song]: a Library song is never a YouTube Music candidate. */
  readonly inLibrary: (song: YtSong) => boolean;
  /**
   * Whether [videoId] can play now; absent: all can. Offline, only the songs
   * the audio cache holds whole.
   */
  readonly playable?: (videoId: string) => boolean;
  /** How the engine ranks (`RecommendOptions`: the Magic Queue section's sliders); absent: its defaults. */
  readonly engine?: Omit<RecommendOptions, "avoid">;
}

/** A session's catalog candidates now. */
export interface MagicCatalogPick {
  /** The best of them, best first: what the next batch picks its YouTube Music songs from. */
  readonly candidates: readonly MagicCatalogCandidate[];
  /** How many the session has left in the catalog, the best and the rest. */
  readonly left: number;
}

/**
 * [session]'s YouTube Music candidates in [sources]' catalog, the best 50
 * (`MAGIC_CATALOG_POOL`) first: the engine's ranking for its radio artists
 * and the seed songs' genre profile (`recommend`, its taste signal the
 * owner's taste profile, its weights [engine]'s), what the session learned
 * of their artists and genres on top. Only songs whose artist matches the
 * seed's genres, and that can play ([playable]); never a song the Library
 * has, one the session queued, one by an artist it excluded, nor a
 * recording the catalog has twice. Each weighs as `magicYtSong` has it.
 */
export const magicCatalogCandidates = (
  session: MagicSession,
  sources: RecommendSources,
  options: MagicCatalogOptions,
): MagicCatalogPick => finishSteps(magicCatalogCandidatesSteps(session, sources, options));

/** The same pick in bounded steps; callers choose when to hand the thread back. */
export function* magicCatalogCandidatesSteps(
  session: MagicSession,
  sources: RecommendSources,
  { inLibrary, playable, engine = {} }: MagicCatalogOptions,
): Generator<void, MagicCatalogPick> {
  // Known styles can establish a match; unknown styles also need family evidence.
  const styles = engine.styles !== undefined;
  const profile = magicSeedProfile(session, sources.profileOf);
  if (!styles && (profile === null || profile.size === 0)) return { candidates: [], left: 0 };
  const candidates = yield* recommendCandidatesSteps(
    { artists: session.radioArtists, profile, style: session.seedStyle },
    sources,
    engine,
  );
  const ranked = yield* rankRecommendedSteps(candidates, engine);
  const used = new Set<string>();
  for (const id of session.used) {
    used.add(id);
    yield;
  }
  const excluded = new Set(session.excludedArtists);
  const seen = new Set<string>();
  const scored: { readonly candidate: MagicCatalogCandidate; readonly score: number }[] = [];
  for (const { song, affinity, score, closeness } of ranked) {
    yield;
    const threshold = engine.threshold ?? GENRE_AFFINITY_THRESHOLD;
    const eligible = song.artists.some((artist) =>
      engine.styles !== undefined
        ? magicStyleMatches(
            { profile, style: session.seedStyle },
            { profile: sources.profileOf(artist), style: sources.styleOf?.(artist) ?? null },
            engine.styles,
            closeness > 0,
            threshold,
          )
        : affinity === "match" && magicGenreMatches(profile, sources.profileOf(artist), threshold),
    );
    if (!eligible) continue;
    const recording = mixRecordingOf(song);
    if (seen.has(recording)) continue;
    seen.add(recording);
    const trackId = ytTrackId(song.videoId);
    if (used.has(trackId) || inLibrary(song)) continue;
    if (playable !== undefined && !playable(song.videoId)) continue;
    if (song.artists.some((artist) => excluded.has(magicArtistKey(artist)))) continue;
    const candidate: MagicCatalogCandidate = {
      ...magicYtSong({ trackId, artists: song.artists }, sources.profileOf, sources.styleOf),
      song: { ...song, video: false },
    };
    const learned = SESSION_SIGNAL * Math.log2(magicSessionWeight(session, candidate));
    scored.push({ candidate, score: score + learned });
  }
  // Stable: songs the session weighs alike keep the engine's order.
  const sorted = yield* sortSteps(scored, (a, b) => b.score - a.score);
  return {
    candidates: yield* mapSteps(sorted.slice(0, MAGIC_CATALOG_POOL), (entry) => entry.candidate),
    left: scored.length,
  };
}

/**
 * A session with fewer catalog candidates left than this runs low: about
 * what one batch's genre lookups aim for (`magicRadioLookups`).
 */
export const MAGIC_CATALOG_LOW = 20;

/**
 * Whether [session] should read its radio artists' radios now (the
 * network, into the catalog), with [left] candidates left in [catalog]: by
 * the harvest's network policy (`harvestNext`), the session a seed of its
 * own. On Wi-Fi when it runs low (fewer than `MAGIC_CATALOG_LOW` left); on
 * mobile data only when none is left, while the harvest's ~5 MB a day
 * (`HARVEST_MOBILE_BYTES`, the same count) aren't used up. Never when its
 * radios were all read in the last 12 hours (`HARVEST_RETRY_MS`: another
 * read would bring the same songs) or its refill was [run]'s `tried` (by
 * session id) in that time, even one that brought nothing (an artist YT
 * Music doesn't have, an empty radio), nor for a session with no radio
 * artists.
 */
export const magicRefillDue = (
  session: MagicSession,
  { catalog, left }: { readonly catalog: readonly CatalogSong[]; readonly left: number },
  run: Pick<HarvestRun, "onMobileData" | "usedToday" | "now" | "tried">,
): boolean => {
  if (session.radioArtists.length === 0) return false;
  const want = {
    id: session.id,
    candidates: left,
    readAt: catalogRadiosReadAt(catalog, session.radioArtists),
  };
  return harvestNext([want], { ...run, read: 0, low: MAGIC_CATALOG_LOW }) !== null;
};
