/**
 * Normalize Volume's gains for the player: each queue entry's Library song
 * plays at its `knownGain` (Core), which the player gets with the entry's
 * item, and again on its own when a value is learned after the item was
 * pushed (a scan reading the song's tags), so it applies when that song
 * starts without pushing the queue again. A song with no value gets none
 * and plays at the typical gain, which the player keeps. Kept free of Expo
 * so it runs under plain Node tests.
 */
import {
  knownGain,
  parseTrackId,
  type GainSource,
  type QueueEntry,
  type SongLoudness,
} from "@wave/core";

/** A queue entry's gain as the player gets it (`PlayerItem`, `setSongGains`); nulls: none. */
export interface PlayerGain {
  readonly gainDb: number | null;
  readonly gainSource: GainSource | null;
}

/** A gain for the entry [key] the player already holds. */
export interface SongGainUpdate extends PlayerGain {
  readonly key: string;
}

const NONE: PlayerGain = { gainDb: null, gainSource: null };

/**
 * The gain the player gets for [entry]: its Library song's `knownGain` from
 * [loudness] (by Track id), or none (a song with no value, a streamed song,
 * whose YouTube value the player learns itself).
 */
export const playerGain = (
  entry: Pick<QueueEntry, "trackId">,
  loudness: ReadonlyMap<number, SongLoudness>,
): PlayerGain => {
  const track = parseTrackId(entry.trackId);
  const song = track?.kind === "library" ? loudness.get(track.id) : undefined;
  const gain = song === undefined ? null : knownGain(song);
  return gain === null ? NONE : { gainDb: gain.gainDb, gainSource: gain.source };
};

const sameGain = (a: PlayerGain, b: PlayerGain): boolean =>
  a.gainDb === b.gainDb && a.gainSource === b.gainSource;

/**
 * What the player was given for the entries it holds, so a value learned
 * later goes only to the entries whose gain it changes.
 */
export const createEntryGains = () => {
  const given = new Map<string, PlayerGain>();
  return {
    /** The gain [entry]'s item carries to the player, from [loudness]. */
    withItem: (
      entry: Pick<QueueEntry, "key" | "trackId">,
      loudness: ReadonlyMap<number, SongLoudness>,
    ): PlayerGain => {
      const gain = playerGain(entry, loudness);
      given.set(entry.key, gain);
      return gain;
    },
    /**
     * The gains [loudness] changes among [entries], which the player holds:
     * those of Library songs it gives another gain than the player has. An
     * entry this run of JS never gave a gain (the player kept its list while
     * JS restarted) gets its gain.
     */
    changes: (
      entries: readonly Pick<QueueEntry, "key" | "trackId">[],
      loudness: ReadonlyMap<number, SongLoudness>,
    ): SongGainUpdate[] =>
      entries.flatMap((entry) => {
        if (parseTrackId(entry.trackId)?.kind !== "library") return [];
        const gain = playerGain(entry, loudness);
        const before = given.get(entry.key);
        if (before !== undefined && sameGain(before, gain)) return [];
        given.set(entry.key, gain);
        return [{ key: entry.key, ...gain }];
      }),
    /** Forgets the entries the player no longer holds ([keys] are those it does). */
    retain: (keys: readonly string[]): void => {
      const held = new Set(keys);
      for (const key of given.keys()) if (!held.has(key)) given.delete(key);
    },
  };
};

export type EntryGains = ReturnType<typeof createEntryGains>;
