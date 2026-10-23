import { parseTrackId } from "./ytMusic.ts";

export interface TrackRowDownloadedInput {
  readonly trackId: string;
  /** The Wave account has the song, but this phone has no file for it. */
  readonly missing?: boolean;
  /** A scan or playback found that the indexed file is gone. */
  readonly fileNotFound?: boolean;
}

/** A Library file carries the downloaded icon in every song list, including offline. */
export const trackRowDownloaded = ({
  trackId,
  missing = false,
  fileNotFound = false,
}: TrackRowDownloadedInput): boolean =>
  !missing && !fileNotFound && parseTrackId(trackId)?.kind === "library";
