import {
  GENIUS_REFERENTS_MAX_PAGES,
  geniusCandidates,
  geniusDescription,
  geniusReferentsPage,
  geniusReferentsUrl,
  geniusSearchUrl,
  geniusSongUrl,
  geniusTranslationRequests,
  pickGeniusSong,
  savedGenius,
  storedGenius,
  withGeniusTranslation,
  type GeniusReferent,
  type SavedGenius,
  type SongLookup,
} from "@wave/core";

/**
 * What Genius insights need from the phone: its key-value store, a GET to
 * Genius with the bearer token, a POST to Google Translate, and whether
 * asking is still allowed (the switch on, the Lyrics view still showing).
 */
export interface GeniusService {
  readonly read: (key: string) => Promise<string | null>;
  readonly keep: (key: string, value: string) => Promise<void>;
  /** GETs [url] with [token] as its bearer token and gives its JSON; rejects when it can't. */
  readonly get: (url: string, token: string) => Promise<unknown>;
  /** POSTs the form [body] to [url] and gives its JSON; rejects when it can't. */
  readonly post: (url: string, body: string) => Promise<unknown>;
  readonly enabled: () => boolean;
}

/**
 * Which song to ask about: its saved answer's [key] (a Library track by its
 * id, a non-D song by its track id), and what its text is translated into
 * ([target], `geniusTranslationTarget`; null for none).
 */
export interface GeniusAsk {
  readonly key: string;
  readonly song: SongLookup;
  readonly token: string;
  readonly target: string | null;
}

/** Where the phone keeps [song]'s Genius answer (`geniusStorage`'s keys all start so). */
export const geniusStorageKey = (song: string): string => `genius.v1:${song}`;

/** Saves [ask]'s song's [answer]; a failed write only costs the next opening a request. */
const saveGenius = (ask: GeniusAsk, answer: SavedGenius, service: GeniusService): Promise<void> =>
  service
    .keep(geniusStorageKey(ask.key), storedGenius(ask.song, answer))
    .catch((cause: unknown) => console.warn("[wave] couldn't save Genius's answer", cause));

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
  try {
    const saved = savedGenius(await service.read(key), now, ask.song);
    if (!service.enabled()) return null;
    if (saved !== null) {
      if (saved.match === null || saved.referents !== null || ask.token.trim() === "") return saved;
      const referents = await loadReferents(saved.match.id, ask.token, service);
      if (!service.enabled()) return null;
      if (referents === null) return saved;
      const result: SavedGenius = { ...saved, referents };
      await saveGenius(ask, result, service);
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
    const result: SavedGenius = { checkedAt: now, match, description, referents, translations: {} };
    await saveGenius(ask, result, service);
    return result;
  } catch (cause) {
    console.warn("[wave] couldn't ask Genius", cause);
    return null;
  }
};

/**
 * [saved] with its text translated into [ask]'s target (docs/spec.md, "Genius
 * About" and "Genius annotations"), saved with the answer. [saved] as it is
 * when there's nothing to ask (no target, no token, insights off, already
 * translated) and when Google can't be reached or answers something
 * unreadable, or asking stops being allowed, on any of a long song's
 * requests: nothing is saved, so the next opening asks again. Never rejects.
 */
export const translateGenius = async (
  ask: GeniusAsk,
  saved: SavedGenius,
  service: GeniusService,
): Promise<SavedGenius> => {
  if (ask.target === null || ask.token.trim() === "" || !service.enabled()) return saved;
  const replies: unknown[] = [];
  try {
    for (const request of geniusTranslationRequests(saved, ask.target)) {
      if (!service.enabled()) return saved;
      replies.push(await service.post(request.url, request.body));
    }
  } catch (cause) {
    console.warn("[wave] couldn't translate Genius's text", cause);
    return saved;
  }
  if (replies.length === 0 || !service.enabled()) return saved;
  const translated = withGeniusTranslation(saved, ask.target, replies);
  if (translated === null) {
    console.warn("[wave] Google Translate's reply couldn't be read");
    return saved;
  }
  await saveGenius(ask, translated, service);
  return translated;
};
