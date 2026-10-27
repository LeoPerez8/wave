import { fileUri } from "../lib/fileUri.ts";

export type ArtworkSize = "thumbnail" | "medium" | "original";

/** Cached paths and an optional remote fallback. Photos take precedence over album covers. */
export interface ArtworkSource {
  readonly thumbPath?: string | null | undefined;
  readonly mediumPath?: string | null | undefined;
  readonly artworkPath?: string | null | undefined;
  readonly imageUrl?: string | null | undefined;
  readonly photo?:
    | {
        readonly thumbPath?: string | null | undefined;
        readonly path?: string | null | undefined;
      }
    | null
    | undefined;
}

/** The size covering a display's long side in physical pixels. */
export const artworkSize = (pixels: number): ArtworkSize =>
  pixels <= 300 ? "thumbnail" : pixels <= 640 ? "medium" : "original";

/**
 * One URI for rows, tiles and full-size art; undefined asks the view for its placeholder.
 * Numbers are physical pixels. A string can be a cached path or an existing URI.
 */
export function artworkUri(
  input: ArtworkSource | string | null | undefined,
  size: ArtworkSize | number = "thumbnail",
): string | undefined {
  if (input == null) return undefined;
  const source = typeof input === "string" ? { artworkPath: input } : input;
  const requested = typeof size === "number" ? artworkSize(size) : size;
  // Only embedded artwork uses derived sizes. Photos and playlist images keep their own files.
  const cachedPath = source.artworkPath ?? source.thumbPath;
  const local = cachedPath?.match(
    /^(?:file:\/\/)?\/(?:[^/]+\/)*artwork\/([0-9a-f]{40})(?:_(thumb|medium)\.jpg|\.(?:jpg|png|webp|gif|bmp|img))$/,
  );
  const served = cachedPath?.match(
    /^content:\/\/dev\.leoperez\.wave\.artwork\/(?:(thumbnail|medium)\/)?([0-9a-f]{40})$/,
  );
  const hash = local?.[1] ?? served?.[2];
  const sameLocalSize =
    local !== null &&
    local !== undefined &&
    ((requested === "thumbnail" && local[2] === "thumb") ||
      (requested === "medium" && local[2] === "medium"));
  const sized = sameLocalSize
    ? cachedPath
    : hash === undefined
      ? undefined
      : `content://dev.leoperez.wave.artwork/${requested === "original" ? "" : requested + "/"}${hash}`;
  const original =
    local?.[2] !== undefined || (served !== null && served !== undefined)
      ? sized
      : source.artworkPath;
  const path =
    requested === "thumbnail"
      ? (source.thumbPath ?? sized ?? source.mediumPath ?? original)
      : requested === "medium"
        ? (source.mediumPath ?? sized ?? original)
        : original;
  const photo =
    requested === "thumbnail"
      ? (source.photo?.thumbPath ?? source.photo?.path)
      : source.photo?.path;
  return fileUri(photo ?? path ?? source.imageUrl);
}
