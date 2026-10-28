import {
  GENIUS_REFERENTS_MAX_PAGES,
  geniusCandidates,
  geniusDescription,
  geniusReferentsPage,
  geniusReferentsUrl,
  geniusSearchUrl,
  geniusSongUrl,
  pickGeniusSong,
  savedGenius,
  storedGenius,
  type GeniusReferent,
  type SavedGenius,
  type SongLookup,
} from "@wave/core";

/**
 * What Genius insights need from the phone: its key-value store, a GET to
 * Genius with the bearer token, and whether asking is still allowed (the
 * switch on, the Lyrics view still showing).
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
 * Every page of the annotated fragments of Genius's song [id] (docs/spec.md,
 * "Genius annotations"), asking the next page while the last one was full.
 * Null when a page can't be had or read, or asking stops being allowed.
 */
const loadReferents = async (
  id: number,
  token: string,
  service: GeniusService,
): Promise<readonly GeniusReferent[] | null> => {
  const referents: GeniusReferent[] = [];
  for (let page = 1; page <= GENIUS_REFERENTS_MAX_PAGES; page += 1) {
    if (!service.enabled()) return null;
    let reply: unknown;
    try {
      reply = await service.get(geniusReferentsUrl(id, page), token);
    } catch (cause) {
      console.warn("[wave] couldn't ask Genius for annotations", cause);
      return null;
    }
    const read = geniusReferentsPage(reply, id);
    if (read === null) return null;
    referents.push(...read.referents);
    if (read.last) break;
  }
  return referents;
};

/**
 * [ask]'s song as Genius knows it (docs/spec.md, "Genius About" and "Genius
 * annotations"): the answer saved on the phone, with no request, or Genius's
 * search and then its song and annotations, saved for next time (a miss
 * too, for a week). A saved match whose annotations were never had asks for
 * them alone. Null with no token, with insights off (checked again before
 * each request and before saving), and when Genius can't be reached or
 * answers something unreadable, which saves nothing; annotations that fail
 * alone leave the rest and are asked again next time. Never rejects.
 */
export const loadGenius = async (
  ask: GeniusAsk,
  service: GeniusService,
  now = Date.now(),
): Promise<SavedGenius | null> => {
  if (!service.enabled()) return null;
  const key = geniusStorageKey(ask.key);
  const save = (result: SavedGenius): Promise<void> =>
    service
      .keep(key, storedGenius(ask.song, result))
      .catch((cause: unknown) => console.warn("[wave] couldn't save Genius's answer", cause));
  try {
    const saved = savedGenius(await service.read(key), now, ask.song);
    if (!service.enabled()) return null;
    if (saved !== null) {
      if (saved.match === null || saved.referents !== null || ask.token.trim() === "") return saved;
      const referents = await loadReferents(saved.match.id, ask.token, service);
      if (!service.enabled()) return null;
      if (referents === null) return saved;
      const result: SavedGenius = { ...saved, referents };
      await save(result);
      return result;
    }
    if (ask.token.trim() === "") return null;
    const hits = geniusCandidates(await service.get(geniusSearchUrl(ask.song), ask.token));
    if (hits === null || !service.enabled()) return null;
    const match = pickGeniusSong(ask.song, hits);
    let description: string | null = null;
    let referents: readonly GeniusReferent[] | null = null;
    if (match !== null) {
      const [song, annotated] = await Promise.all([
        service.get(geniusSongUrl(match.id), ask.token),
        loadReferents(match.id, ask.token, service),
      ]);
      const about = geniusDescription(song, match.id);
      if (about === null || !service.enabled()) return null;
      description = about.text;
      referents = annotated;
    }
    const result: SavedGenius = { checkedAt: now, match, description, referents };
    await save(result);
    return result;
  } catch (cause) {
    console.warn("[wave] couldn't ask Genius", cause);
    return null;
  }
};
