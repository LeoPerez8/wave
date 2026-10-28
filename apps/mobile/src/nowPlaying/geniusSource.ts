import {
  geniusCandidates,
  geniusDescription,
  geniusSearchUrl,
  geniusSongUrl,
  pickGeniusSong,
  savedGenius,
  storedGenius,
  type SavedGenius,
  type SongLookup,
} from "@wave/core";

/**
 * What Genius insights need from the phone: its key-value store, a GET to
 * Genius with the bearer token, and whether asking is still allowed (the
 * switch on, the Lyrics view still showing). Annotations (#742) reuse it.
 */
export interface GeniusService {
  readonly read: (key: string) => Promise<string | null>;
  readonly keep: (key: string, value: string) => Promise<void>;
  /** GETs [url] with [token] as its bearer token and gives its JSON; rejects when it can't. */
  readonly get: (url: string, token: string) => Promise<unknown>;
  readonly enabled: () => boolean;
}

/** Which song to ask about: its saved answer's [key] (a Library track by its id, a non-D song by its track id). */
export interface GeniusAsk {
  readonly key: string;
  readonly song: SongLookup;
  readonly token: string;
}

/** Where the phone keeps [song]'s Genius answer (`geniusStorage`'s keys all start so). */
export const geniusStorageKey = (song: string): string => `genius.v1:${song}`;

/**
 * [ask]'s song as Genius knows it (docs/spec.md, "Genius About"): the answer
 * saved on the phone, with no request, or Genius's search and then its song,
 * saved for next time (a miss too, for a week). Null with no token, with
 * insights off (checked again before each request and before saving), and
 * when Genius can't be reached or answers something unreadable, which saves
 * nothing. Never rejects.
 */
export const loadGenius = async (
  ask: GeniusAsk,
  service: GeniusService,
  now = Date.now(),
): Promise<SavedGenius | null> => {
  if (!service.enabled()) return null;
  try {
    const key = geniusStorageKey(ask.key);
    const saved = savedGenius(await service.read(key), now, ask.song);
    if (!service.enabled()) return null;
    if (saved !== null) return saved;
    if (ask.token.trim() === "") return null;
    const hits = geniusCandidates(await service.get(geniusSearchUrl(ask.song), ask.token));
    if (hits === null || !service.enabled()) return null;
    const match = pickGeniusSong(ask.song, hits);
    let description: string | null = null;
    if (match !== null) {
      const about = geniusDescription(
        await service.get(geniusSongUrl(match.id), ask.token),
        match.id,
      );
      if (about === null || !service.enabled()) return null;
      description = about.text;
    }
    const result: SavedGenius = { checkedAt: now, match, description };
    await service
      .keep(key, storedGenius(ask.song, result))
      .catch((cause: unknown) => console.warn("[wave] couldn't save Genius's answer", cause));
    return result;
  } catch (cause) {
    console.warn("[wave] couldn't ask Genius", cause);
    return null;
  }
};
