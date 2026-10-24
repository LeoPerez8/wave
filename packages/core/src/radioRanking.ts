/** Shared radio ranking for Magic Queue, mixes and playlist suggestions. */
import { artistNeighbourhood, type ArtistGraph } from "./artistGraph.ts";
import {
  GENRE_AFFINITY_THRESHOLD,
  genreAffinity,
  type GenreProfile,
  type GenreProfileOf,
} from "./genreAffinity.ts";
import { magicArtistKey, magicYtSong, type MagicSong, type MagicSignal } from "./magicQueue.ts";
import type { MixSliderStep } from "./mixSliders.ts";
import { tasteWeight, type TasteProfile } from "./tasteProfile.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { recordingMatches, recordingMatchTitle, ytTrackId } from "./ytMusic.ts";

/** One radio's songs in playback order; append continuations to the same page. */
export interface RadioRankingPage {
  readonly id: string;
  readonly artists: readonly string[];
  readonly songs: readonly YtAlbumSong[];
}
export interface RadioRankingSeed {
  readonly artists: readonly string[];
  readonly profile?: GenreProfile | null;
}
export interface RadioRankingSources {
  readonly pages: readonly RadioRankingPage[];
  readonly profileOf?: GenreProfileOf;
  readonly graph?: ArtistGraph | null;
  readonly taste?: TasteProfile | null;
  readonly signals?: readonly MagicSignal[];
  /** Fraction from 0 to 1; e.g. 1 - 0.5 ** distinctRadioCount. */
  readonly popularityOf?: (videoId: string) => number;
  /** Playable Library songs. Genre never excludes them. */
  readonly library?: readonly MagicSong[];
  /** Resolve radio recordings with libraryFinder; return null for a song without a local file. */
  readonly inLibrary?: (song: YtAlbumSong) => MagicSong | null;
}
export interface RadioRankingOptions {
  readonly faithfulness?: MixSliderStep;
  readonly popularity?: MixSliderStep;
  /** Queue track ids already played, queued or explicitly excluded by the caller. */
  readonly exclude?: ReadonlySet<string>;
}
export interface RankedRadioSong extends MagicSong {
  readonly source: "stream" | "library";
  readonly song: YtAlbumSong | null;
  /** Best position across the supplied radios, zero-based. Null for Library additions. */
  readonly radio: { readonly id: string; readonly position: number } | null;
  readonly score: number;
}

/** Higher scores first, ties in input order. Inputs are never mutated. */
export const rankRadioSongs = (
  seed: RadioRankingSeed,
  sources: RadioRankingSources,
  options: RadioRankingOptions = {},
): RankedRadioSong[] => {
  const ranked = new Map<string, RankedRadioSong>();
  const profileOf = sources.profileOf ?? (() => null);
  const excluded = new Set(options.exclude);
  for (const signal of sources.signals ?? [])
    if (signal.kind === "removed") excluded.add(signal.song.trackId);
  const add = (candidate: RankedRadioSong): void => {
    if (
      excluded.has(candidate.trackId) ||
      (candidate.song !== null && excluded.has(ytTrackId(candidate.song.videoId)))
    )
      return;
    let session = 0;
    for (const signal of sources.signals ?? []) {
      const same = signal.song.trackId === candidate.trackId;
      const artist = signal.song.artists.some((name) => candidate.artists.includes(name));
      if (!same && !artist) continue;
      session += { skip: -3, removed: -3, favorite: 3, download: 2, playedThrough: 1, added: 1 }[
        signal.kind
      ];
    }
    const taste = sources.taste == null ? 0 : Math.log2(tasteWeight(sources.taste, candidate)) / 2;
    const popularity =
      candidate.song === null ? 0 : (sources.popularityOf?.(candidate.song.videoId) ?? 0);
    candidate = {
      ...candidate,
      score:
        candidate.score +
        Math.max(-4, Math.min(4, session)) +
        taste +
        ((3 - (options.popularity ?? 3)) * popularity) / 2,
    };
    const previous = ranked.get(candidate.trackId);
    if (previous === undefined || candidate.score > previous.score)
      ranked.set(candidate.trackId, candidate);
  };
  for (const page of sources.pages) {
    for (const [position, song] of page.songs.entries()) {
      const local = sources.inLibrary?.(song) ?? null;
      if (local !== null && excluded.has(ytTrackId(song.videoId))) excluded.add(local.trackId);
      const profiles = song.artists.flatMap((artist) => {
        const profile = profileOf(artist);
        return profile == null || profile.size === 0 ? [] : [profile];
      });
      const affinity =
        seed.profile == null || seed.profile.size === 0 || profiles.length === 0
          ? null
          : Math.max(...profiles.map((profile) => genreAffinity(seed.profile!, profile)));
      const incompatible = affinity !== null && affinity < GENRE_AFFINITY_THRESHOLD;
      const step = options.faithfulness ?? 3;
      if (local === null && incompatible && step === 1) continue;
      const penalty = local === null && incompatible ? { 1: 0, 2: 8, 3: 5, 4: 2, 5: 0 }[step] : 0;
      add({
        ...(local ??
          magicYtSong({ trackId: ytTrackId(song.videoId), artists: song.artists }, profileOf)),
        source: local === null ? "stream" : "library",
        song,
        radio: { id: page.id, position },
        score: 10 / (1 + position / 10) - penalty,
      });
    }
  }
  const close = new Set(seed.artists.map(magicArtistKey));
  if (sources.graph != null)
    for (const artist of artistNeighbourhood(sources.graph, seed.artists))
      close.add(magicArtistKey(artist.name));
  for (const song of sources.library ?? []) {
    if (song.artists.some((artist) => close.has(artist)) && !ranked.has(song.trackId)) {
      add({ ...song, source: "library", song: null, radio: null, score: 5 });
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- fresh array; Hermes lacks toSorted
  const sorted = [...ranked.values()].sort((a, b) => b.score - a.score);
  const recordings = new Map<string, YtAlbumSong[]>();
  return sorted.filter((candidate) => {
    if (candidate.song === null) return true;
    const song = candidate.song;
    const title = recordingMatchTitle(song.title);
    const previous = recordings.get(title) ?? [];
    if (
      previous.some((other) =>
        recordingMatches(
          {
            title: other.title,
            artist: other.artists.join(", "),
            durationMs: other.durationMs ?? 0,
          },
          song,
        ),
      )
    )
      return false;
    previous.push(song);
    recordings.set(title, previous);
    return true;
  });
};

/** Blend ranked pools at New music's share, filling either short pool from the other. */
export const radioRankingBatch = (
  ranked: readonly RankedRadioSong[],
  { size, newMusicShare }: { readonly size: number; readonly newMusicShare: number },
): RankedRadioSong[] => {
  const fresh = ranked.filter((song) => song.source === "stream");
  const library = ranked.filter((song) => song.source === "library");
  const target = Math.round(size * Math.max(0, Math.min(1, newMusicShare)));
  const local = library.slice(0, size - Math.min(fresh.length, target));
  const streams = fresh.slice(0, size - local.length);
  const result: RankedRadioSong[] = [];
  let at = 0;
  for (const [index, song] of streams.entries()) {
    result.push(song);
    const due = Math.floor(((index + 1) * local.length) / streams.length);
    while (at < due) result.push(local[at++]!);
  }
  if (streams.length === 0) return local;
  return result;
};
