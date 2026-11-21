/**
 * Home's Community playlists (docs/spec.md, YT Music): the playlists of the
 * shelves YouTube Music shows on the connected account's home. Wave reads
 * that home at most once a day and keeps the list on the phone, so the
 * section still shows offline. The list is one account's: another account
 * neither sees it nor waits a day for its own.
 */

import { localDay } from "./discoverMixes.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";
import type { YtCommunityPlaylist } from "./ytSearch.ts";

/** A shelf of YouTube Music's home that holds playlists and nothing else. */
export interface YtPlaylistShelf {
  readonly title: string;
  readonly playlists: readonly YtCommunityPlaylist[];
}

/** The most playlists Home's Community playlists shows. */
export const HOME_COMMUNITY_PLAYLISTS = 20;

/** After a read that failed: no other before this long has passed. */
export const HOME_COMMUNITY_PLAYLISTS_RETRY_MS = 10 * 60 * 1000;

/**
 * The playlists Home takes from the home's [shelves]: the shelves in their
 * order, each one's playlists in its order, a playlist only where it first
 * is, up to `HOME_COMMUNITY_PLAYLISTS`.
 */
export const homeCommunityPlaylists = (
  shelves: readonly YtPlaylistShelf[],
): YtCommunityPlaylist[] => {
  const seen = new Set<string>();
  const playlists: YtCommunityPlaylist[] = [];
  for (const shelf of shelves)
    for (const playlist of shelf.playlists) {
      if (playlists.length === HOME_COMMUNITY_PLAYLISTS) return playlists;
      if (seen.has(playlist.playlistId)) continue;
      seen.add(playlist.playlistId);
      playlists.push(playlist);
    }
  return playlists;
};

/**
 * Whose list it is, as the phone keeps it: a fingerprint of the account's
 * [email] (its FNV-1a hash), so the kept list names no one.
 */
const accountKey = (email: string): string => {
  let hash = 0x811c9dc5;
  for (const char of email.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
};

/** The list the phone keeps: what the last read gave, when it was read and for which account. */
export interface KeptCommunityPlaylists {
  /** When YouTube Music's home was last read (ms since the epoch). */
  readonly readAt: number;
  /** The account it was read as (a fingerprint, never its email). */
  readonly account: string;
  readonly playlists: readonly YtCommunityPlaylist[];
}

const keptFor = (
  kept: KeptCommunityPlaylists | null,
  account: string | null,
): KeptCommunityPlaylists | null =>
  kept !== null && account !== null && kept.account === accountKey(account) ? kept : null;

/**
 * What to keep after the home was read at [now] as [account] (its email)
 * and gave [shelves]. A home with no playlist shelves that day keeps the
 * playlists [previous] holds for that account, and still counts as the
 * day's read.
 */
export const keptCommunityPlaylists = (
  previous: KeptCommunityPlaylists | null,
  shelves: readonly YtPlaylistShelf[],
  { now, account }: { readonly now: number; readonly account: string },
): KeptCommunityPlaylists => {
  const playlists = homeCommunityPlaylists(shelves);
  return {
    readAt: now,
    account: accountKey(account),
    playlists: playlists.length > 0 ? playlists : (keptFor(previous, account)?.playlists ?? []),
  };
};

/**
 * Whether to read YouTube Music's home at [now]: only with a connected
 * [account] (its email, null without one), never while a read is going
 * ([reading]) or before a failed one may be tried again ([retryAt]), and at
 * most once a day, from the next day on the phone's calendar after the last
 * read ([kept], null for never). A list kept for another account doesn't
 * count as a read. Read later than now, the clock went back, so it's read again.
 */
export const homeCommunityPlaylistsDue = (
  kept: KeptCommunityPlaylists | null,
  at: {
    readonly now: number;
    readonly account: string | null;
    readonly reading: boolean;
    readonly retryAt: number | null;
  },
): boolean => {
  if (at.account === null || at.reading) return false;
  if (at.retryAt !== null && at.now < at.retryAt) return false;
  const last = keptFor(kept, at.account);
  return last === null || last.readAt > at.now || localDay(last.readAt) !== localDay(at.now);
};

const NONE: readonly YtCommunityPlaylist[] = [];

/**
 * The playlists Home's Community playlists shows, none for a section left
 * out: it needs a connected [account] (its email, null without one) and a
 * list kept for it that isn't empty.
 */
export const homeCommunityPlaylistsShown = (
  kept: KeptCommunityPlaylists | null,
  { account }: { readonly account: string | null },
): readonly YtCommunityPlaylist[] => keptFor(kept, account)?.playlists ?? NONE;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const storedPlaylist = (value: unknown): YtCommunityPlaylist | null => {
  if (!isRecord(value)) return null;
  const playlistId = text(value.playlistId);
  const title = text(value.title);
  if (playlistId === null || playlistId === "" || title === null) return null;
  return { playlistId, title, author: text(value.author), artworkUrl: text(value.artworkUrl) };
};

/** The kept list [stored] holds; null for nothing stored or anything unreadable. */
export const parseKeptCommunityPlaylists = (
  stored: string | null,
): KeptCommunityPlaylists | null => {
  const { version, readAt, account, playlists } = readStoredRecord(stored);
  if (version !== 1 || typeof readAt !== "number" || !Array.isArray(playlists)) return null;
  if (typeof account !== "string") return null;
  return {
    readAt,
    account,
    playlists: playlists.flatMap((entry: unknown) => {
      const playlist = storedPlaylist(entry);
      return playlist === null ? [] : [playlist];
    }),
  };
};

/** What to store for [kept] (`parseKeptCommunityPlaylists` reads it back); null (nothing) for none. */
export const storedKeptCommunityPlaylists = (kept: KeptCommunityPlaylists | null): string | null =>
  kept === null
    ? null
    : JSON.stringify({
        version: 1,
        readAt: kept.readAt,
        account: kept.account,
        playlists: kept.playlists,
      });
