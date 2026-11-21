/** A Recognize card's cover, fetched by main: the window's page loads no image from the web. */

/** Covers larger than this aren't shown. */
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** [url]'s image as a data URL, or null for anything that isn't an https image of a sane size. */
export const fetchCover = async (
  url: string,
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>,
): Promise<string | null> => {
  if (!url.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_COVER_BYTES) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
};
