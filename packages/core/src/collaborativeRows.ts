/**
 * The rows of a collaborative playlist as the sync service keeps them
 * (docs/spec.md, Collaborative playlists, "Limits and validation"): several
 * accounts write them, so a cover address is kept only on YouTube's and
 * Google's image hosts, and the texts other members' apps show are cut to
 * the length of a real name. The app checks a cover with the same rule.
 */

/** The longest title, artist, album or playlist name a collaborative playlist keeps, in characters. */
export const COLLABORATIVE_TEXT_MAX_LENGTH = 300;

/** An https address on YouTube's or Google's image hosts, with no user or port. */
const IMAGE_HOST = /^https:\/\/(?:[a-z0-9-]+\.)*(?:ytimg|googleusercontent|ggpht)\.com(?:\/|$)/i;

/** Whether [url] is a cover address a collaborative playlist keeps. */
export const isCollaborativeCoverUrl = (url: string): boolean => IMAGE_HOST.test(url);

/** [text] cut to `COLLABORATIVE_TEXT_MAX_LENGTH` characters, never in the middle of one. */
const bounded = (text: string): string => {
  if (text.length <= COLLABORATIVE_TEXT_MAX_LENGTH) return text;
  const characters = Array.from(text);
  return characters.length <= COLLABORATIVE_TEXT_MAX_LENGTH
    ? text
    : characters.slice(0, COLLABORATIVE_TEXT_MAX_LENGTH).join("");
};

type Row = Readonly<Record<string, unknown>>;

/** [row] with each text field of [names] bounded; the same object when none changes. */
const boundFields = <T extends Row>(row: T, names: readonly string[]): T => {
  let out: Record<string, unknown> | null = null;
  for (const name of names) {
    const value = row[name];
    if (typeof value !== "string") continue;
    const cut = bounded(value);
    if (cut !== value) (out ??= { ...row })[name] = cut;
  }
  return (out ?? row) as T;
};

/** A stored song (`yt_song`) bounded and with a cover kept only on the image hosts; as it is when unreadable. */
const boundStoredSong = (stored: string): string => {
  let song: unknown;
  try {
    song = JSON.parse(stored);
  } catch {
    return stored;
  }
  if (typeof song !== "object" || song === null || Array.isArray(song)) return stored;
  let out = boundFields(song as Row, ["title", "album"]);
  const { artists, artworkUrl } = out;
  if (Array.isArray(artists)) {
    const cut = artists.map((artist: unknown) =>
      typeof artist === "string" ? bounded(artist) : artist,
    );
    if (cut.some((artist, i) => artist !== artists[i])) out = { ...out, artists: cut };
  }
  if (typeof artworkUrl === "string" && !isCollaborativeCoverUrl(artworkUrl)) {
    out = { ...out, artworkUrl: null };
  }
  return out === song ? stored : JSON.stringify(out);
};

/**
 * [row], a wire row of a collaborative playlist's [table], as the service
 * keeps it: the playlist's name, an entry's title, artist credit and album,
 * and its stored song's title, artists and album bounded, and a stored
 * song's cover dropped (null) unless it is on YouTube's or Google's image
 * hosts. A row it doesn't change comes back as the same object.
 */
export const collaborativeRow = <T extends Row>(
  table: "playlists" | "playlistEntries",
  row: T,
): T => {
  if (table === "playlists") return boundFields(row, ["name"]);
  const fields = boundFields(row, ["title", "credit", "album"]);
  const { ytSong } = fields;
  if (typeof ytSong !== "string") return fields;
  const song = boundStoredSong(ytSong);
  return song === ytSong ? fields : { ...fields, ytSong: song };
};

/** The fields of a collaborative playlist's row that a member writes; the owner keeps the rest. */
const MEMBER_PLAYLIST_FIELDS: readonly string[] = ["name"];

/**
 * The fields a collaborative playlist's row keeps after a member's change [pushed] to it,
 * stored as [stored]: the member renames it (docs/spec.md, Collaborative playlists), and every
 * other field, such as when it was made, stays as stored.
 */
export const memberPlaylistFields = <T extends Row>(stored: T, pushed: Row): T => {
  const out: Record<string, unknown> = { ...stored };
  for (const name of MEMBER_PLAYLIST_FIELDS) if (name in pushed) out[name] = pushed[name];
  return out as T;
};
