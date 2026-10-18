/**
 * A streamed song's cover for playback (Now Playing, the notification, Auto)
 * and the cover cache: as large as a download embeds it, while lists keep
 * the small thumbnails YouTube Music's rows carry.
 */

import { COVER_SIZE, largeCover } from "./ytDownload.ts";

/** A video thumbnail's address: `i.ytimg.com/vi/<videoId>/<name>.jpg`, or `vi_webp` and `.webp`. */
const VIDEO_THUMBNAIL = /^https?:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/([\w-]+)\//;

/** A video's thumbnails from the largest down: maxres (1280 px) and sd (640 px) aren't always there, hq (480 px) is. */
const VIDEO_THUMBNAILS = ["maxresdefault", "sddefault", "hqdefault"] as const;

/**
 * The addresses to ask for [url]'s cover at for playback, best first. YouTube
 * Music's image server takes the size in the address (`=w120-h120`, or
 * `=s120` for one side), so its covers are asked for at the size downloads
 * embed. A video thumbnail doesn't: it's the video's largest thumbnail,
 * down to the one every video has. Other covers stay as they are. The last
 * address is always there, so it stands in while none is cached.
 */
export const streamedCoverUrls = (url: string): readonly string[] => {
  const video = VIDEO_THUMBNAIL.exec(url);
  if (video !== null) {
    return VIDEO_THUMBNAILS.map((name) => `https://i.ytimg.com/vi/${video[1]}/${name}.jpg`);
  }
  return [largeCover(url).replace(/=s\d+(?=[-?]|$)/, `=s${COVER_SIZE}`)];
};

/** The address the player shows [url]'s cover from while none is cached: the last of `streamedCoverUrls`. */
export const streamedCoverUrl = (url: string): string => {
  const urls = streamedCoverUrls(url);
  return urls[urls.length - 1] ?? url;
};
