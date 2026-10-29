import { ytDownloadLine, ytDownloadProgress, type YtDownloadStatus } from "./ytDownloads.ts";
import {
  playlistSongKey,
  unsearchedTrackId,
  unavailableEntryView,
  type UnsearchedSong,
  type UnavailableSong,
} from "./playlistEntries.ts";
import { ytSongArtist, ytSongCredit, ytTrackId, type YtSong } from "./ytMusic.ts";
import type { ExplicitFlag } from "./explicit.ts";
import { showsExplicitBadge } from "./explicit.ts";
import { trackRowDownloaded } from "./trackRowDownloaded.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { trackRowTrailing } from "./trackRowTrailing.ts";

/** Local cover files, not URIs. The app's artwork helper resolves the chosen file. */
export interface SongRowFiles {
  readonly thumbPath?: string | null | undefined;
  readonly mediumPath?: string | null | undefined;
  readonly artworkPath?: string | null | undefined;
}

/** Only the Library fields a row displays. Full songs and paged summaries fit structurally. */
export interface SongRowLibrarySong extends SongRowFiles {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number;
  readonly explicit: ExplicitFlag;
}

export type SongRowSource = (
  | {
      readonly kind: "library";
      readonly song: SongRowLibrarySong & { readonly path: string | null };
    }
  | {
      readonly kind: "librarySummary";
      readonly song: SongRowLibrarySong & { readonly hasFile: boolean };
    }
  | { readonly kind: "missing"; readonly song: SongRowLibrarySong }
  | { readonly kind: "ytMusic"; readonly song: YtSong }
  | { readonly kind: "unsearched"; readonly song: UnsearchedSong }
  | { readonly kind: "unavailable"; readonly song: UnavailableSong }
  | {
      readonly kind: "queue";
      readonly entry: { readonly key: string; readonly trackId: string };
      readonly track?:
        (SongRowFiles & { readonly title: string; readonly artist: string }) | undefined;
      readonly missing?: boolean;
      /** Queue History fades the cover and title, without adding to the spoken label. */
      readonly history?: boolean;
    }
  | {
      readonly kind: "history";
      readonly id: number | string;
      /** Current Library id, if the snapshot's song still exists. */
      readonly trackId?: string | undefined;
      readonly title: string;
      readonly artist: string;
      readonly durationMs: number | null;
      readonly explicit?: ExplicitFlag | boolean;
      /** Resolved by the history artwork policy: snapshot, current song, then remote. */
      readonly artwork?: SongRowArtwork;
      readonly missing?: boolean;
      readonly unavailable?: boolean;
      readonly disabled?: boolean;
    }
) & {
  /** A persisted playlist entry id, when the list has one. */
  readonly key?: string;
  /** Zero for the first song; positive only for actual duplicates, never the list index. */
  readonly occurrence?: number;
};

/** Non-song slots whose trees must never recycle into a song row. */
export type SongListRowSource =
  | SongRowSource
  | { readonly kind: "discHeader"; readonly key: string; readonly label: string }
  | { readonly kind: "loading"; readonly key: string };

export type SongRowRecycleType =
  | "librarySong"
  | "ytSong"
  | "queueSong"
  | "queueHistory"
  | "unavailableEntry"
  | "discHeader"
  | "loadingRow";

/**
 * A row's cover. Rows request thumbnails: a local cover hands over the files
 * it has, and the app's one artwork helper picks among them, so a row
 * follows the same fallback order as every other cover.
 */
export type SongRowArtwork =
  | { readonly kind: "file"; readonly files: SongRowFiles }
  | { readonly kind: "remote"; readonly url: string; readonly size: "thumbnail" }
  | { readonly kind: "placeholder" };

export type SongRowLeading =
  | { readonly kind: "artwork" | "playDisc" }
  | { readonly kind: "trackNumber"; readonly number?: number | undefined }
  | { readonly kind: "rank"; readonly number: number };

export interface SongRowState {
  readonly playing?: boolean;
  readonly starred?: boolean;
  readonly selection?: "off" | "checked" | "unchecked" | "disabled";
  readonly leading?: SongRowLeading;
  readonly countedPlays?: number | undefined;
  readonly trailingLabel?: string | undefined;
  readonly kindLine?: boolean;
  readonly download?: YtDownloadStatus | null | undefined;
  readonly fileNotFound?: boolean;
  readonly unavailable?: boolean;
  readonly disabled?: boolean;
  /** False suppresses remote covers when YT Music is off. Local files still display. */
  readonly remoteArtwork?: boolean;
  /** The language the row reads in; English unless given. */
  readonly language?: AppLanguage | undefined;
}

export interface SongRowView {
  readonly key: string;
  readonly recycleType: SongRowRecycleType;
  readonly title: string;
  readonly secondLine: string;
  readonly trailingText: string;
  readonly badges: { readonly explicit: boolean; readonly downloaded: boolean };
  readonly artwork: SongRowArtwork;
  readonly dimmed: boolean;
  readonly disabled: boolean;
  readonly downloadLine: string | null;
  readonly progress: number | null;
  readonly fileNotFound: boolean;
  readonly fileNotFoundIcon: "leading" | "trailing" | null;
  readonly playing: boolean;
  readonly starred: boolean;
  readonly selecting: boolean;
  readonly leading:
    | Exclude<SongRowLeading, { readonly kind: "rank" }>
    | { readonly kind: "rank"; readonly number: number; readonly top: boolean };
  readonly accessibilityState:
    | { readonly disabled: boolean; readonly selected: boolean }
    | { readonly disabled: boolean; readonly checked: boolean };
  readonly accessibilityLabel: string;
  readonly accessibilityRole: "button" | "checkbox" | "header" | "text";
}

const localArtwork = ({ thumbPath, mediumPath, artworkPath }: SongRowFiles): SongRowArtwork =>
  thumbPath || mediumPath || artworkPath
    ? {
        kind: "file",
        files: {
          ...(thumbPath ? { thumbPath } : {}),
          ...(mediumPath ? { mediumPath } : {}),
          ...(artworkPath ? { artworkPath } : {}),
        },
      }
    : { kind: "placeholder" };

interface RowContent {
  readonly key: string;
  readonly trackId: string;
  readonly recycleType: SongRowRecycleType;
  readonly title: string;
  readonly credit: string;
  readonly durationMs: number | null;
  readonly explicit: boolean;
  readonly artwork: SongRowArtwork;
  readonly missing: boolean;
  readonly unavailable: boolean;
  readonly disabled: boolean;
}

const contentOf = (source: SongRowSource, language: AppLanguage = "en"): RowContent => {
  switch (source.kind) {
    case "library":
    case "librarySummary":
    case "missing": {
      const { song } = source;
      const missing =
        source.kind === "missing" ||
        (source.kind === "library"
          ? source.song.path === null
          : source.kind === "librarySummary" && !source.song.hasFile);
      return {
        key: String(song.id),
        trackId: String(song.id),
        recycleType: "librarySong",
        title: song.title,
        credit: song.artist,
        durationMs: song.durationMs,
        explicit: showsExplicitBadge(song.explicit),
        artwork: localArtwork(song),
        missing,
        unavailable: false,
        disabled: false,
      };
    }
    case "ytMusic":
    case "unsearched":
    case "unavailable": {
      const { song } = source;
      const key =
        source.kind === "ytMusic"
          ? ytTrackId(source.song.videoId)
          : source.kind === "unsearched"
            ? unsearchedTrackId(song)
            : playlistSongKey({ source: "unavailable", song: source.song });
      return {
        key,
        trackId: key,
        recycleType: source.kind === "unavailable" ? "unavailableEntry" : "ytSong",
        title: song.title,
        credit:
          source.kind === "unavailable"
            ? unavailableEntryView(source.song, language).line
            : ytSongCredit(song),
        durationMs: song.durationMs,
        explicit: source.kind === "ytMusic" && showsExplicitBadge(source.song.explicit),
        artwork: song.artworkUrl
          ? { kind: "remote", url: song.artworkUrl, size: "thumbnail" }
          : { kind: "placeholder" },
        missing: false,
        unavailable: source.kind === "unavailable",
        disabled: false,
      };
    }
    case "queue":
      return {
        key: source.entry.key,
        trackId: source.track === undefined ? "" : source.entry.trackId,
        recycleType: source.history ? "queueHistory" : "queueSong",
        title: source.track?.title ?? " ",
        credit: source.track?.artist ?? " ",
        durationMs: null,
        explicit: false,
        artwork: localArtwork(source.track ?? {}),
        missing: source.missing === true,
        unavailable: false,
        disabled: false,
      };
    case "history":
      return {
        key: `play:${source.id}`,
        trackId: source.trackId ?? `history:${source.id}`,
        recycleType: source.trackId === undefined ? "ytSong" : "librarySong",
        title: source.title,
        credit: source.artist,
        durationMs: source.durationMs,
        explicit: showsExplicitBadge(source.explicit ?? false),
        artwork: source.artwork ?? { kind: "placeholder" },
        missing: source.missing === true,
        unavailable: source.unavailable === true,
        disabled: source.disabled === true,
      };
  }
};

/**
 * The id a row's song goes by in the queue, for its playing flag, star and
 * download; null for a slot that isn't a song. A queue entry whose song is
 * gone from the Library has none (""), so it never shows as playing.
 */
export const songRowTrackId = (source: SongListRowSource): string | null =>
  source.kind === "discHeader" || source.kind === "loading" ? null : contentOf(source).trackId;

/** Computes display values only: no stores, callbacks, queries or native dependencies. */
export const songRowView = (source: SongListRowSource, state: SongRowState = {}): SongRowView => {
  const language = state.language ?? "en";
  const text = catalogueOf(language).library;
  const playing = state.playing === true;
  const selection = state.selection ?? "off";
  const selecting = selection !== "off";
  const leading =
    state.leading?.kind === "rank"
      ? { ...state.leading, top: state.leading.number === 1 }
      : (state.leading ?? { kind: "artwork" as const });
  if (source.kind === "discHeader" || source.kind === "loading") {
    const title = source.kind === "discHeader" ? source.label : "";
    return {
      key: source.key,
      recycleType: source.kind === "discHeader" ? "discHeader" : "loadingRow",
      title,
      secondLine: "",
      trailingText: "",
      badges: { explicit: false, downloaded: false },
      artwork: { kind: "placeholder" },
      dimmed: false,
      disabled: true,
      downloadLine: null,
      progress: null,
      fileNotFound: false,
      fileNotFoundIcon: null,
      playing: false,
      starred: false,
      selecting: false,
      leading,
      accessibilityState: { disabled: true, selected: false },
      accessibilityRole: source.kind === "discHeader" ? "header" : "text",
      accessibilityLabel: source.kind === "discHeader" ? title : text.row.loadingSong,
    };
  }
  const row = contentOf(source, language);
  const unavailable = row.unavailable || state.unavailable === true;
  const fileNotFound = state.fileNotFound === true;
  const downloaded =
    !unavailable &&
    trackRowDownloaded({ trackId: row.trackId, missing: row.missing, fileNotFound });
  const queue = source.kind === "queue";
  const remoteSong = source.kind === "ytMusic" || source.kind === "unsearched";
  const download = row.missing || remoteSong ? (state.download ?? null) : null;
  const downloadLine = ytDownloadLine(download);
  const baseCredit =
    source.kind === "ytMusic" && state.leading?.kind === "trackNumber"
      ? ytSongArtist(source.song)
      : row.credit;
  const credit =
    remoteSong && downloadLine !== null
      ? downloadLine
      : state.kindLine
        ? text.songRow(baseCredit)
        : baseCredit;
  const trailingText =
    state.trailingLabel ??
    trackRowTrailing({ durationMs: row.durationMs, countedPlays: state.countedPlays });
  const disabled =
    row.disabled || state.disabled === true || fileNotFound || selection === "disabled";
  return {
    key: source.key ?? (source.occurrence ? `${row.key}:occurrence:${source.occurrence}` : row.key),
    recycleType: row.recycleType,
    title: row.title,
    secondLine: fileNotFound ? text.row.fileNotFound : (downloadLine ?? credit),
    trailingText,
    badges: { explicit: row.explicit, downloaded },
    artwork:
      state.remoteArtwork === false && row.artwork.kind === "remote"
        ? { kind: "placeholder" }
        : row.artwork,
    dimmed: row.missing || unavailable || (queue && source.history === true),
    disabled,
    downloadLine,
    progress: ytDownloadProgress(download),
    fileNotFound,
    fileNotFoundIcon: !fileNotFound
      ? null
      : leading.kind === "trackNumber" || leading.kind === "rank"
        ? "leading"
        : "trailing",
    playing,
    starred: state.starred === true,
    selecting,
    leading,
    accessibilityRole: selecting ? "checkbox" : "button",
    accessibilityState: selecting
      ? { disabled, checked: selection === "checked" }
      : { disabled, selected: playing },
    accessibilityLabel: queue
      ? `${source.track?.title ?? text.row.song}, ${source.track?.artist ?? ""}${downloaded ? `, ${text.row.downloaded}` : ""}`
      : [
          row.title,
          credit,
          ...(state.trailingLabel === undefined ? [] : [state.trailingLabel]),
          ...(row.explicit ? [text.row.explicit] : []),
          ...(state.countedPlays === undefined ? [] : [trailingText]),
          ...(downloaded ? [text.row.downloaded] : []),
          ...(row.missing ? [downloadLine ?? text.row.notDownloaded] : []),
          ...(unavailable ? [text.row.unavailable] : []),
          ...(playing ? [text.row.nowPlaying] : []),
        ].join(", "),
  };
};
