import type { Appearance, LaunchTheme, TagDestination } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

/** One audio file as read by the native scanner (`modules/wave-native`). Tag values are raw. */
export interface NativeScannedTrack {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
  readonly title: string | null;
  readonly artist: string | null;
  /** Every value of a multi-value artist tag, each a credit of its own; [artist] is the first. */
  readonly artists?: readonly string[] | null;
  readonly album: string | null;
  readonly albumArtist: string | null;
  /** Every value of a multi-value album artist tag, as [artists]. */
  readonly albumArtists?: readonly string[] | null;
  readonly genre: string | null;
  readonly year: string | null;
  readonly trackNumber: string | null;
  readonly discNumber: string | null;
  readonly compilation: boolean;
  readonly durationMs: number;
  readonly sampleRate: number | null;
  readonly bitrateKbps: number | null;
  readonly artworkHash: string | null;
  /** Lyrics in its tags or a sidecar `.lrc` beside it. */
  readonly hasLyrics: boolean;
  /** The advisory tag as tagged (`ITUNESADVISORY`, MP4 `rtng`); null without one. */
  readonly advisory?: string | null;
}

/** Colours picked from an artwork, as signed ARGB ints. */
export interface NativeArtworkPalette {
  readonly dominant: number | null;
  readonly vibrant: number | null;
  readonly darkVibrant: number | null;
  readonly lightVibrant: number | null;
  readonly muted: number | null;
  readonly darkMuted: number | null;
  readonly lightMuted: number | null;
}

export interface NativeArtwork {
  readonly hash: string;
  readonly path: string;
  readonly thumbPath: string;
  readonly palette: NativeArtworkPalette;
}

export interface ScanProgressEvent {
  readonly scanId: number;
  readonly phase: "discovering" | "reading";
  readonly filesFound: number;
  /** Files whose tags were read so far. */
  readonly filesRead: number;
  /** Found files an incremental scan skipped because the index has them as they are. */
  readonly filesUnchanged: number;
}

/** Known files the scan didn't find; sent once, before the first batch. */
export interface ScanMissingEvent {
  readonly scanId: number;
  readonly paths: readonly string[];
}

export interface ScanBatchEvent {
  readonly scanId: number;
  readonly tracks: readonly NativeScannedTrack[];
  /** Artwork first referenced by this batch; each unique image is sent once per scan. */
  readonly artwork: readonly NativeArtwork[];
}

export interface ScanCompleteEvent {
  readonly scanId: number;
  readonly filesFound: number;
  readonly filesRead: number;
  readonly filesUnchanged: number;
  readonly cancelled: boolean;
  readonly durationMs: number;
}

export interface ScanErrorEvent {
  readonly scanId: number;
  readonly message: string;
}

/** A track's lyrics as found on disk; Core's `pickLyrics` decides what to show. */
export interface NativeLyrics {
  readonly embedded: string | null;
  readonly sidecar: string | null;
}

/** The outcome of the system folder picker. */
export type FolderPick =
  | { readonly status: "picked"; readonly path: string }
  | { readonly status: "cancelled" }
  /** A folder without a file path, such as the Downloads shortcut or a cloud drive. */
  | { readonly status: "unsupported" };

/** A playlist file picked with `pickPlaylistFiles` (Core's `M3uFile`, text null when unreadable). */
export interface PickedPlaylistFile {
  readonly name: string;
  /** Its absolute path, for its relative entries; null when its provider has none (a cloud drive). */
  readonly path: string | null;
  readonly text: string | null;
}

type WaveNativeEvents = {
  onScanProgress: (event: ScanProgressEvent) => void;
  onScanMissing: (event: ScanMissingEvent) => void;
  onScanBatch: (event: ScanBatchEvent) => void;
  onScanComplete: (event: ScanCompleteEvent) => void;
  onScanError: (event: ScanErrorEvent) => void;
  /** Text was shared to Wave; `takeSharedText` has it. */
  onShareReceived: () => void;
};

declare class WaveNativeModule extends NativeModule<WaveNativeEvents> {
  /** Whether Wave holds "All files access" (MANAGE_EXTERNAL_STORAGE). */
  hasAllFilesAccess(): boolean;
  /** Opens the system settings screen where the user grants all-files access. */
  requestAllFilesAccess(): Promise<void>;
  /** Absolute path of the shared `Music` folder. */
  getDefaultMusicFolder(): string;
  /** Opens the system folder picker and resolves the picked folder's absolute path. */
  pickFolder(): Promise<FolderPick>;
  /** Opens the system file picker for M3U playlists; one result per picked file, none when cancelled. */
  pickPlaylistFiles(): Promise<readonly PickedPlaylistFile[]>;
  /** Opens the system file picker for files of any type (BlackPlayer's stats), read as `pickPlaylistFiles` reads them. */
  pickStatFiles(): Promise<readonly PickedPlaylistFile[]>;
  /** The clipboard's text, or null when it holds none. Only readable while Wave is in front. */
  readClipboardText(): Promise<string | null>;
  /**
   * The latest text shared to Wave from another app's share sheet, once: the
   * share that started Wave or one since. Null when nothing new was shared.
   */
  takeSharedText(): string | null;
  /**
   * Starts a scan, cancelling any running one, and returns its id. The known
   * files (parallel lists) make it incremental: files with the same size and
   * modification time aren't read again, and known files under the roots that
   * are gone are reported in `onScanMissing`.
   */
  startScan(
    roots: readonly string[],
    excluded: readonly string[],
    knownPaths: readonly string[],
    knownSizes: readonly number[],
    knownModifiedAt: readonly number[],
  ): number;
  cancelScan(scanId: number): void;
  /** A track's lyrics, unparsed: from its tags and from a sidecar `.lrc` beside it. */
  readLyrics(path: string): Promise<NativeLyrics>;
  /**
   * Deletes audio files and their sidecar `.lrc`; one outcome per path, in
   * order. MediaStore is told about the deleted ones.
   */
  deleteFiles(paths: readonly string[]): Promise<readonly FileDeleteOutcome[]>;
  /**
   * Downloads an artist's photo in both sizes beside the album artwork (files
   * named after [artistKey]); rejects when a download fails or isn't an image.
   */
  saveArtistPhoto(artistKey: string, thumbUrl: string, largeUrl: string): Promise<ArtistPhotoFiles>;
  /** Deletes every downloaded artist photo. */
  clearArtistPhotos(): Promise<void>;
  /**
   * Opens Android's photo picker for a playlist's image and saves the picked
   * photo, cropped to a square, in Wave's storage (new files each time).
   * Null when nothing was picked; rejects when the photo can't be read.
   */
  pickPlaylistImage(): Promise<PlaylistImageFiles | null>;
  /** Deletes playlist image files `pickPlaylistImage` saved; other paths are left alone. */
  deletePlaylistImages(paths: readonly string[]): Promise<void>;
  /**
   * Makes `alias` (one of `aliases`, activity-alias names without the package)
   * Wave's launcher icon. It switches once Wave leaves the screen.
   */
  setLauncherIcon(alias: string, aliases: readonly string[]): Promise<void>;
  /**
   * Saves what the next cold start opens on (Core's `launchTheme`) and, on
   * Android 13+, picks its splash style for Android to draw.
   */
  setLaunchTheme(theme: LaunchTheme): Promise<void>;
  /**
   * Has Android keep Wave in `appearance` (its night mode for Wave alone),
   * across restarts: the launch splash and system bars open in it.
   */
  setAppearance(appearance: Appearance): Promise<void>;
  /** Dark or light navigation-bar buttons, for the scheme Wave shows now. */
  setNavigationBarScheme(dark: boolean): Promise<void>;
  /**
   * Writes found lyrics (LRC or plain text) and genre into a song's file,
   * replacing what's there, and fills in its track number (with `discNumber`),
   * year and advisory tag (Core's `advisoryTag`: 1 explicit, 0 clean), keeping
   * any the file has; null leaves a field alone. A format Wave can't write
   * tags to gets the lyrics in a sidecar `.lrc` and nothing else. Rejects when
   * the file can't be written.
   */
  writeLyricsAndGenre(
    path: string,
    lyrics: string | null,
    genre: string | null,
    trackNumber: number | null,
    discNumber: number | null,
    year: number | null,
    advisory: 0 | 1 | null,
  ): Promise<NativeTagWrite>;
}

/**
 * Where `writeLyricsAndGenre` put what it was given (Core's `TagWriteReport`)
 * and, when the tags changed or a sidecar was written, the file read again as
 * a scan reads it.
 */
export interface NativeTagWrite {
  readonly lyrics: "tags" | "sidecar" | "none";
  readonly genre: TagDestination;
  readonly trackNumber: TagDestination;
  readonly year: TagDestination;
  readonly explicit: TagDestination;
  readonly track: NativeScannedTrack | null;
  readonly artwork: NativeArtwork | null;
}

/** A saved artist photo: the large image (artist page) and the thumbnail (lists). */
export interface ArtistPhotoFiles {
  readonly path: string;
  readonly thumbPath: string;
}

/** A playlist's own image: the large one (its page) and the thumbnail (lists, Android Auto). */
interface PlaylistImageFiles {
  readonly path: string;
  readonly thumbPath: string;
}

/** What became of a file `deleteFiles` was asked to delete (Core's `SongDeleteFailureReason` otherwise). */
export type FileDeleteOutcome = "deleted" | "missing" | "denied" | "readOnly" | "failed";

export const WaveNative = requireNativeModule<WaveNativeModule>("WaveNative");

/** Converts a signed ARGB int from Android into a `#rrggbb` CSS colour. */
export const argbToHex = (argb: number): string =>
  `#${((argb >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;
