/** Magic Queue keeps its seed in the lead while learning from liked-song radios. */
import { radioRankingBatch, type RankedRadioSong } from "./radioRanking.ts";
import type { MagicSession, MagicSongRadioSeed } from "./magicQueue.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { recordingMatches, recordingMatchTitle, ytTrackId } from "./ytMusic.ts";

/** Keep learned recordings out even when a Library song's video id was unknown before its radio read. */
export const magicRadioExclusions = (
  session: MagicSession,
  songs: Iterable<YtAlbumSong>,
): ReadonlySet<string> => {
  const exclude = new Set(session.used);
  for (const id of session.seedVideoIds) exclude.add(ytTrackId(id));
  const recordings = new Map<string, MagicSongRadioSeed[]>();
  for (const radio of session.likedRadios ?? []) {
    if (radio.videoId !== undefined) exclude.add(ytTrackId(radio.videoId));
    const key = recordingMatchTitle(radio.title);
    const bucket = recordings.get(key) ?? [];
    bucket.push(radio);
    recordings.set(key, bucket);
  }
  for (const song of songs)
    if (
      (recordings.get(recordingMatchTitle(song.title)) ?? []).some((radio) =>
        recordingMatches(
          {
            title: radio.title,
            artist: radio.artists.join(", "),
            durationMs: radio.durationMs ?? 0,
          },
          song,
        ),
      )
    )
      exclude.add(ytTrackId(song.videoId));
  return exclude;
};

/** About a third from liked radios, filling shortages from the other pool. */
export const magicRadioBatch = (
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
  options: { readonly size: number; readonly newMusicShare: number },
): RankedRadioSong[] => {
  const ids = new Set(seed.map((song) => song.trackId));
  const recordings = new Map<string, NonNullable<RankedRadioSong["song"]>[]>();
  for (const candidate of seed) {
    if (candidate.song === null) continue;
    const key = recordingMatchTitle(candidate.song.title);
    const bucket = recordings.get(key) ?? [];
    bucket.push(candidate.song);
    recordings.set(key, bucket);
  }
  // A recording the original radio brought belongs to its majority, even if a liked radio has it too.
  const extra = liked.filter((candidate) => {
    if (ids.has(candidate.trackId)) return false;
    const song = candidate.song;
    return (
      song === null ||
      !(recordings.get(recordingMatchTitle(song.title)) ?? []).some(
        (other) =>
          other.videoId === song.videoId ||
          recordingMatches(
            {
              title: other.title,
              artist: other.artists.join(", "),
              durationMs: other.durationMs ?? 0,
            },
            song,
          ),
      )
    );
  });
  const learned = radioRankingBatch(extra, {
    ...options,
    size: Math.max(Math.round(options.size / 3), options.size - seed.length),
  });
  const remaining = options.size - learned.length;
  const streams = Math.round(options.size * Math.max(0, Math.min(1, options.newMusicShare)));
  const original = radioRankingBatch(seed, {
    size: remaining,
    newMusicShare:
      remaining === 0
        ? 0
        : (streams - learned.filter((song) => song.source === "stream").length) / remaining,
  });
  if (original.length === 0) return learned;
  const result: RankedRadioSong[] = [];
  let at = 0;
  for (const [index, song] of original.entries()) {
    result.push(song);
    const due = Math.floor(((index + 1) * learned.length) / original.length);
    while (at < due) result.push(learned[at++]!);
  }
  return result;
};

const batchSize = (session: MagicSession): number => (session.batches === 0 ? 9 : 10);

/** Whether each radio pool needs continuations to fill its batch and New music share. */
export const magicRadioReadPlan = (
  session: MagicSession,
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
  hasLikedRadios: boolean,
): {
  readonly size: number;
  readonly likedQuota: number;
  readonly seedLow: boolean;
  readonly likedLow: boolean;
} => {
  const size = batchSize(session);
  const likedQuota = hasLikedRadios ? Math.round(size / 3) : 0;
  const low = (ranked: readonly RankedRadioSong[], target: number) =>
    ranked.length < target ||
    ranked.filter((song) => song.source === "stream").length < Math.round(target * session.ytShare);
  return {
    size,
    likedQuota,
    seedLow: low(seed, size - Math.min(likedQuota, liked.length)),
    likedLow: hasLikedRadios && low(liked, Math.max(likedQuota, size - seed.length)),
  };
};

/** Selects and commits a ranked batch against the latest session, including recording aliases. */
export const completeMagicRadioBatch = (
  session: MagicSession,
  seed: readonly RankedRadioSong[],
  liked: readonly RankedRadioSong[],
): { readonly session: MagicSession; readonly trackIds: readonly string[] } => {
  const exclude = magicRadioExclusions(
    session,
    [...seed, ...liked].flatMap((s) => s.song ?? []),
  );
  const eligible = (song: RankedRadioSong) =>
    !exclude.has(song.trackId) &&
    (song.song === null || !exclude.has(ytTrackId(song.song.videoId)));
  const selected = magicRadioBatch(seed.filter(eligible), liked.filter(eligible), {
    size: batchSize(session),
    newMusicShare: session.ytShare,
  });
  const trackIds = selected.map((song) => song.trackId);
  if (trackIds.length === 0) return { session, trackIds };
  const used = new Set(session.used);
  for (const song of selected) {
    used.add(song.trackId);
    if (song.song !== null) used.add(ytTrackId(song.song.videoId));
  }
  return { trackIds, session: { ...session, used: [...used], batches: session.batches + 1 } };
};
