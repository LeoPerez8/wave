/**
 * A streamed song's cover for playback (Now Playing, the notification, Auto)
 * and the cover cache: as large as a download embeds it, while lists keep
 * the small thumbnails YouTube Music's rows carry. Playlist covers ask for
 * the size they show (`sizedCoverUrls`).
 */

import { COVER_SIZE, largeCover } from "./ytDownload.ts";

/** A video thumbnail's address: `i.ytimg.com/vi/<videoId>/<name>.jpg`, or `vi_webp` and `.webp`. */
const VIDEO_THUMBNAIL = /^https?:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/([\w-]+)\//;

/**
 * A video's thumbnails from the largest down, each with the short side a
 * square cover crops to: maxres (1280 px wide) and sd (640 px) aren't always
 * there, hq (480 px) is.
 */
const VIDEO_THUMBNAILS = [
  { name: "maxresdefault", side: 720 },
  { name: "sddefault", side: 480 },
  { name: "hqdefault", side: 360 },
] as const;

/** Up to this side (a list row) a video keeps the thumbnail it stored: hq is the smallest larger one, and letterboxed. */
const VIDEO_ROW_SIDE = 180;

const videoThumbnail = (videoId: string | undefined, name: string): string =>
  `https://i.ytimg.com/vi/${videoId}/${name}.jpg`;

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
    return VIDEO_THUMBNAILS.map(({ name }) => videoThumbnail(video[1], name));
  }
  return [largeCover(url).replace(/=s\d+(?=[-?]|$)/, `=s${COVER_SIZE}`)];
};

/** The address the player shows [url]'s cover from while none is cached: the last of `streamedCoverUrls`. */
export const streamedCoverUrl = (url: string): string => {
  const urls = streamedCoverUrls(url);
  return urls[urls.length - 1] ?? url;
};

/** YouTube Music's image server, which takes the size in the address. */
const YT_IMAGE_SERVER = /^https?:\/\/[\w.-]+\.(?:googleusercontent|ggpht)\.com\//;

/** The size in such an address: `=w120-h120` or `=s120`, before any other option. */
const YT_IMAGE_SIZE = /=(?:w(\d+)-h(\d+)|s(\d+))(?=[-?]|$)/;

/** Spotify's 300 px album cover: the 640 px one differs only in this prefix (`ab67616d0000b273`). */
const SPOTIFY_ALBUM_COVER = /^https?:\/\/i\.scdn\.co\/image\/ab67616d00001e02[0-9a-f]+$/;
const SPOTIFY_ALBUM_COVER_SIDE = 300;

/**
 * The addresses to ask for the stored cover [url] at, for a square [pixels]
 * physical pixels wide, best first. The last is always [url] itself: it shows
 * meanwhile, and stays when none of the others loads. A cover already as
 * large as that, and any other image, is only [url].
 */
export const sizedCoverUrls = (url: string, pixels: number): readonly string[] => {
  const side = Math.min(Math.ceil(pixels), COVER_SIZE);
  if (YT_IMAGE_SERVER.test(url)) {
    const size = YT_IMAGE_SIZE.exec(url);
    if (size === null || Number(size[1] ?? size[3]) >= side) return [url];
    const sized = size[1] === undefined ? `=s${side}` : `=w${side}-h${side}`;
    return [url.replace(YT_IMAGE_SIZE, sized), url];
  }
  const video = VIDEO_THUMBNAIL.exec(url);
  if (video !== null) {
    if (side <= VIDEO_ROW_SIDE) return [url];
    const large = VIDEO_THUMBNAILS.filter((thumbnail) => thumbnail.side >= side).length;
    return [
      ...VIDEO_THUMBNAILS.slice(Math.max(large - 1, 0)).map(({ name }) =>
        videoThumbnail(video[1], name),
      ),
      url,
    ];
  }
  if (side > SPOTIFY_ALBUM_COVER_SIDE && SPOTIFY_ALBUM_COVER.test(url)) {
    return [url.replace("ab67616d00001e02", "ab67616d0000b273"), url];
  }
  return [url];
};
