/**
 * Genius insights (docs/spec.md, "Genius About"): what Wave asks Genius's
 * public API about a song, which search hit is the song, what its reply
 * says about it and what the phone keeps of it. The app sends the requests
 * and keeps the saved text.
 */

import { savedGeniusReferents, type GeniusReferent } from "./geniusAnnotations.ts";
import { isSameSong, type SongLookup } from "./lyricsAndGenre.ts";

/** The Genius song a song matched: what annotations (#742) ask Genius about by its id. */
export interface GeniusMatch {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  readonly url: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Genius's search for [song]: its title and artist, nothing else. */
export const geniusSearchUrl = (song: Pick<SongLookup, "title" | "artist">): string =>
  `https://api.genius.com/search?q=${encodeURIComponent(`${song.title} ${song.artist}`)}`;

/** Genius's song [id], its description as plain text. */
export const geniusSongUrl = (id: number): string =>
  `https://api.genius.com/songs/${id}?text_format=plain`;

const responseBody = (reply: unknown): Record<string, unknown> | null =>
  record(reply) && record(reply.meta) && reply.meta.status === 200 && record(reply.response)
    ? reply.response
    : null;

/** A song Genius's search found: its match, and its full credit ("Queen & David Bowie"). */
export interface GeniusHit extends GeniusMatch {
  readonly credit: string;
}

/** Null means a failed reply, an empty array a successful search with no songs. */
export const geniusCandidates = (reply: unknown): GeniusHit[] | null => {
  const body = responseBody(reply);
  if (!body || !Array.isArray(body.hits)) return null;
  return body.hits.flatMap((hit: unknown) => {
    if (!record(hit) || hit.type !== "song" || !record(hit.result)) return [];
    const song = hit.result;
    if (
      !positiveId(song.id) ||
      typeof song.title !== "string" ||
      !record(song.primary_artist) ||
      typeof song.primary_artist.name !== "string" ||
      typeof song.url !== "string"
    )
      return [];
    const artist = song.primary_artist.name;
    const credit = typeof song.artist_names === "string" ? song.artist_names : artist;
    return [{ id: song.id, title: song.title, artist, credit, url: song.url }];
  });
};

/**
 * The first of Genius's [hits] that is [song], by Fix Song's comparison
 * (`isSameSong`) against either its primary artist or its full credit; null
 * when none is: no confident match.
 */
export const pickGeniusSong = (
  song: SongLookup,
  hits: readonly GeniusHit[],
): GeniusMatch | null => {
  const hit = hits.find(
    (each) =>
      isSameSong(song, each.title, each.artist) || isSameSong(song, each.title, each.credit),
  );
  return hit === undefined
    ? null
    : { id: hit.id, title: hit.title, artist: hit.artist, url: hit.url };
};

/** An unreadable reply is a failure; a valid song without an About text is a miss. */
export const geniusDescription = (
  reply: unknown,
  id: number,
): { readonly text: string | null } | null => {
  const song = responseBody(reply)?.song;
  if (!record(song) || song.id !== id) return null;
  if (!record(song.description) || typeof song.description.plain !== "string") return null;
  const text = song.description.plain.trim();
  return { text: text === "" || text === "?" ? null : text };
};

/** How long a miss (no match, or a match without a description) is kept before asking again. */
export const GENIUS_MISS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What the phone keeps for a song (this phone only, never synced): when it
 * was asked, the Genius song it matched, kept without a description too so
 * its annotations can be asked, the description, and the annotated
 * fragments (`geniusReferentsPage`; null while not asked yet, as an answer
 * saved before annotations came, or after they failed).
 */
export interface SavedGenius {
  readonly checkedAt: number;
  readonly match: GeniusMatch | null;
  readonly description: string | null;
  readonly referents: readonly GeniusReferent[] | null;
}

/** [song]'s Genius answer as the phone stores it, with the title and artist it was asked for. */
export const storedGenius = (
  song: Pick<SongLookup, "title" | "artist">,
  answer: SavedGenius,
): string =>
  JSON.stringify({
    version: 1,
    asked: { title: song.title, artist: song.artist },
    checkedAt: answer.checkedAt,
    match: answer.match,
    description: answer.description,
    referents: answer.referents,
  });

const isMatch = (value: unknown): value is GeniusMatch =>
  record(value) &&
  positiveId(value.id) &&
  typeof value.title === "string" &&
  typeof value.artist === "string" &&
  typeof value.url === "string";

/**
 * [song]'s Genius answer read back from [stored] (`storedGenius`): null when
 * there's nothing, it can't be read, it was asked for another title or
 * artist (the song's tags changed since), or it is a miss a week old at [now].
 */
export const savedGenius = (
  stored: string | null,
  now: number,
  song: Pick<SongLookup, "title" | "artist">,
): SavedGenius | null => {
  if (stored === null) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(stored);
  } catch {
    return null;
  }
  if (
    !record(saved) ||
    saved.version !== 1 ||
    !record(saved.asked) ||
    saved.asked.title !== song.title ||
    saved.asked.artist !== song.artist ||
    typeof saved.checkedAt !== "number" ||
    !Number.isFinite(saved.checkedAt) ||
    (saved.match !== null && !isMatch(saved.match)) ||
    (saved.description !== null && typeof saved.description !== "string")
  )
    return null;
  const { checkedAt, match, description } = saved;
  const referents = saved.referents == null ? null : savedGeniusReferents(saved.referents);
  if (saved.referents != null && referents === null) return null;
  if (description === null && now - checkedAt >= GENIUS_MISS_MS) return null;
  return { checkedAt, match, description, referents };
};
