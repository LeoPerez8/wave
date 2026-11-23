/**
 * The photo a Wave account is shown with to the other members of a collaborative playlist
 * (docs/spec.md, "Collaborative playlists"): the Google account's photo, as the sync service
 * keeps it. Only an address on Google's photo host is kept, so the other members' phones load
 * nothing off that host. Once the account has signed in since photos were kept, the address is
 * the ID token's; before that, an app can send any address on the host.
 */

/** The longest photo address kept, in characters. */
export const ACCOUNT_PHOTO_URL_MAX_LENGTH = 2048;

/** The photo host's domain; the address's host must be one of its subdomains. */
const PHOTO_DOMAIN = ".googleusercontent.com";

/**
 * `https://`, then a host of letters, digits, dots and hyphens (no user, no port), then
 * nothing or a path, query or fragment without space, control characters or backslashes.
 */
const ADDRESS = /^https:\/\/([a-z0-9.-]+)(?:[/?#][^\s\p{Cc}\\]*)?$/iu;

/**
 * The photo address to keep for [value]: [value] itself when it is an `https:` URL whose host
 * ends in `.googleusercontent.com`, else `null` (not text, another scheme or host, or past
 * `ACCOUNT_PHOTO_URL_MAX_LENGTH`).
 */
export const accountPhotoUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > ACCOUNT_PHOTO_URL_MAX_LENGTH) return null;
  const host = ADDRESS.exec(value)?.[1]?.toLowerCase();
  if (host === undefined || !host.endsWith(PHOTO_DOMAIN)) return null;
  const labels = host.split(".");
  return labels.every((label) => label !== "") ? value : null;
};
