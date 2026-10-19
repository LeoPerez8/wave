/**
 * The harvest (docs/spec.md, "Discover", harvest): the background job that
 * refills the candidate catalog by reading the radios of the seeds and
 * genre families whose candidates run low, apart from building mixes (which
 * reads only the phone). Core decides which seed to read next and when:
 * every low one on Wi-Fi; on mobile data only one with no candidates left,
 * within about 5 MB a day.
 */

import { catalogSeedKey } from "./candidateCatalog.ts";
import { catalogMixRead, type CatalogMixSources } from "./catalogMixes.ts";
import {
  MIX_MOST,
  discoverMixSongs,
  localDay,
  mixSeedArtists,
  type DiscoverMixSeed,
} from "./discoverMixes.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";
import type { YtSong } from "./ytMusic.ts";

/** A seed (or genre family) as the harvest weighs it. */
export interface HarvestWant {
  /** The seed's id (`DiscoverMixSeed.id`). */
  readonly id: string;
  /** How many new songs its mix would keep from the catalog now. */
  readonly candidates: number;
  /**
   * When its radios were last read (the catalog's latest from each, the
   * earliest of its artists'); null when one never was.
   */
  readonly readAt: number | null;
}

/** A seed with fewer candidates than this runs low: a mix's most songs. */
export const HARVEST_LOW = MIX_MOST;

/** A seed whose radios were read (or tried) this recently isn't read again: 12 hours. */
export const HARVEST_RETRY_MS = 12 * 60 * 60 * 1000;

/** The most seeds one harvest run reads. */
export const HARVEST_SEEDS = 8;

/** What the harvest may use of mobile data in a day: about 5 MB. */
export const HARVEST_MOBILE_BYTES = 5 * 1024 * 1024;

/** A harvest runs at most this often: 15 minutes. */
export const HARVEST_EVERY_MS = 15 * 60 * 1000;

/** The latest each radio was read, by seed artist (`catalogSeedKey`). */
const radiosReadAt = (catalog: CatalogMixSources["catalog"]): Map<string, number> => {
  const readAt = new Map<string, number>();
  for (const { radios } of catalog)
    for (const radio of radios)
      readAt.set(radio.seed, Math.max(readAt.get(radio.seed) ?? 0, radio.lastSeenAt));
  return readAt;
};

/**
 * What the harvest wants of each of [seeds]: how many new songs its mix
 * would keep from the catalog now (`catalogMixRead`, then
 * `discoverMixSongs` with what the owner [known]s, the other seeds aside),
 * and when its radios were last read.
 */
export const harvestWants = <S extends DiscoverMixSeed>(
  seeds: readonly S[],
  sources: CatalogMixSources & {
    /** The songs the owner knows (`mixKnownSongs`): never a mix's new songs. */
    readonly known: { readonly known: (song: YtSong) => boolean };
  },
): (HarvestWant & { readonly seed: S })[] => {
  const readAt = radiosReadAt(sources.catalog);
  return seeds.map((seed) => {
    const read = catalogMixRead(seed, sources);
    const candidates =
      read === null
        ? 0
        : discoverMixSongs([read.radio], {
            known: sources.known.known,
            taken: new Set(),
            ...(read.affinity === undefined ? {} : { affinity: read.affinity }),
          }).length;
    let earliest: number | null = Number.POSITIVE_INFINITY;
    for (const { name } of mixSeedArtists(seed)) {
      const key = catalogSeedKey(name);
      const at = key === null ? undefined : readAt.get(key);
      earliest = at === undefined || earliest === null ? null : Math.min(earliest, at);
    }
    return {
      seed,
      id: seed.id,
      candidates,
      readAt: earliest === Number.POSITIVE_INFINITY ? null : earliest,
    };
  });
};

/** Where a harvest run stands. */
export interface HarvestRun {
  /** Whether the phone is on mobile data (read once a run). */
  readonly onMobileData: boolean;
  /** The mobile data the harvest used today, in bytes (`harvestMobileUsedToday`). */
  readonly usedToday: number;
  readonly now: number;
  /** How many seeds the run has read. */
  readonly read: number;
  /** When each seed was last tried in this session (a read that may have brought nothing), by id. */
  readonly tried?: ReadonlyMap<string, number>;
}

/**
 * The seed of [wants] the harvest reads next, or null for none: on Wi-Fi,
 * one running low (fewer than `HARVEST_LOW` candidates); on mobile data,
 * only one with no candidates left, while the day's ~5 MB
 * (`HARVEST_MOBILE_BYTES`) aren't used up. Never one read or tried in the
 * last 12 hours (`HARVEST_RETRY_MS`), nor more than eight a run
 * (`HARVEST_SEEDS`). The emptiest goes first, then the least recently read.
 */
export const harvestNext = <W extends HarvestWant>(
  wants: readonly W[],
  { onMobileData, usedToday, now, read, tried }: HarvestRun,
): W | null => {
  if (read >= HARVEST_SEEDS) return null;
  if (onMobileData && usedToday >= HARVEST_MOBILE_BYTES) return null;
  let next: { readonly want: W; readonly lastAt: number } | null = null;
  for (const want of wants) {
    const lastAt = Math.max(want.readAt ?? 0, tried?.get(want.id) ?? 0);
    if (lastAt > 0 && now - lastAt < HARVEST_RETRY_MS) continue;
    if (onMobileData ? want.candidates > 0 : want.candidates >= HARVEST_LOW) continue;
    if (
      next === null ||
      want.candidates < next.want.candidates ||
      (want.candidates === next.want.candidates && lastAt < next.lastAt)
    )
      next = { want, lastAt };
  }
  return next?.want ?? null;
};

/** Whether a harvest is due, the last one having started at [lastRunAt]: every 15 minutes at most. */
export const harvestDue = (lastRunAt: number | null, now: number): boolean =>
  lastRunAt === null || now - lastRunAt >= HARVEST_EVERY_MS;

/** The mobile data the harvest used on a day. */
export interface HarvestMobileUse {
  /** The day (`localDay`). */
  readonly day: string;
  readonly bytes: number;
}

/** The mobile data the harvest used on [now]'s day, as [use] counts it. */
export const harvestMobileUsedToday = (use: HarvestMobileUse | null, now: number): number =>
  use !== null && use.day === localDay(now) ? use.bytes : 0;

/** [use] with [bytes] more used at [now]: a new day starts afresh. */
export const withHarvestMobileUse = (
  use: HarvestMobileUse | null,
  bytes: number,
  now: number,
): HarvestMobileUse => ({ day: localDay(now), bytes: harvestMobileUsedToday(use, now) + bytes });

/** What to save for [use]. */
export const storedHarvestMobileUse = (use: HarvestMobileUse): string =>
  JSON.stringify({ version: 1, day: use.day, bytes: use.bytes });

/** The use [stored] holds; null when nothing readable is saved. */
export const parseHarvestMobileUse = (stored: string | null): HarvestMobileUse | null => {
  const record = readStoredRecord(stored);
  if (!isRecord(record) || record.version !== 1) return null;
  const { day, bytes } = record;
  return typeof day === "string" && typeof bytes === "number" && Number.isFinite(bytes)
    ? { day, bytes }
    : null;
};
