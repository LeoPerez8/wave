/**
 * Reading a smart link's page (docs/spec.md, "Opening a song link" › Smart
 * links), before the phone or the desktop opens the link it points to as if
 * it had been shared.
 */
import { smartLinkTarget } from "@wave/core";

/** The link a smart link points to, or why it opens nothing. */
export type SmartLinkEnding =
  { readonly link: string } | { readonly failure: "cantOpen" | "unreachable" };

/**
 * Downloads the smart link [url]'s page once through [follow] (its redirects
 * followed, no cookies; `followShortLink`) and gives the link it points to:
 * where it landed when that's a service's page Wave opens, else the one its
 * page names (`smartLinkTarget`). A page naming none can't be opened; no
 * answer is the page out of reach.
 */
export const smartLinkEnding = async (
  url: string,
  follow: (
    url: string,
    body: boolean,
    signal: AbortSignal,
  ) => Promise<{ readonly url: string; readonly body: string }>,
  signal: AbortSignal,
): Promise<SmartLinkEnding> => {
  let landed;
  try {
    landed = await follow(url, true, signal);
  } catch {
    return { failure: "unreachable" };
  }
  const link = smartLinkTarget(landed.url) ?? smartLinkTarget(landed.body);
  return link === null ? { failure: "cantOpen" } : { link };
};
