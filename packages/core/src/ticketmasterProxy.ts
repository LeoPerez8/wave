/**
 * Ticketmaster through Wave's sync service (docs/spec.md, "Followed
 * artists"): a show check asks the service's fixed Ticketmaster routes, and
 * the service asks Ticketmaster Discovery with its own key. These are the
 * only requests the routes take: an artist's attraction search and its
 * events in one country, each as the show check used to ask Ticketmaster.
 */

/** The longest artist name the service searches, in characters. */
export const TICKETMASTER_KEYWORD_MAX_LENGTH = 500;

const DISCOVERY = "https://app.ticketmaster.com/discovery/v2";

/** The service's attraction search for the artist [name]. */
export const ticketmasterAttractionsPath = (name: string): string =>
  `/v1/ticketmaster/attractions?keyword=${encodeURIComponent(name)}`;

/** The service's events of attraction [attractionId] in [country] (an ISO 3166 code). */
export const ticketmasterEventsPath = (attractionId: string, country: string): string =>
  `/v1/ticketmaster/events?attractionId=${encodeURIComponent(attractionId)}&countryCode=${encodeURIComponent(country)}`;

/** [params]' values when it holds exactly [names], each once; null otherwise. */
const exactly = (params: URLSearchParams, names: readonly string[]): string[] | null => {
  const keys = [...params.keys()];
  if (keys.length !== names.length || names.some((name) => params.getAll(name).length !== 1))
    return null;
  return names.map((name) => params.get(name) ?? "");
};

/** [params] as a query, each value as `encodeURIComponent` writes it. */
const query = (params: readonly (readonly [string, string])[]): string =>
  params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");

/**
 * The Ticketmaster request the service makes for a phone's [pathname] and
 * [params] (a `ticketmasterAttractionsPath` or `ticketmasterEventsPath`
 * request), without the key the service adds; null for any other path, a
 * parameter missing, repeated or extra, an empty or overlong name, an
 * attraction id that isn't plain letters, digits, `_` or `-`, or a country
 * that isn't two capital letters.
 */
export const ticketmasterUpstreamUrl = (
  pathname: string,
  params: URLSearchParams,
): string | null => {
  switch (pathname) {
    case "/v1/ticketmaster/attractions": {
      const [keyword] = exactly(params, ["keyword"]) ?? [];
      if (
        keyword === undefined ||
        keyword.trim() === "" ||
        keyword.length > TICKETMASTER_KEYWORD_MAX_LENGTH
      )
        return null;
      return `${DISCOVERY}/attractions.json?${query([
        ["keyword", keyword],
        ["classificationName", "music"],
        ["size", "200"],
      ])}`;
    }
    case "/v1/ticketmaster/events": {
      const [attractionId, country] = exactly(params, ["attractionId", "countryCode"]) ?? [];
      if (attractionId === undefined || !/^[A-Za-z0-9_-]{1,64}$/.test(attractionId)) return null;
      if (country === undefined || !/^[A-Z]{2}$/.test(country)) return null;
      return `${DISCOVERY}/events.json?${query([
        ["attractionId", attractionId],
        ["countryCode", country],
        ["sort", "date,asc"],
        ["size", "200"],
      ])}`;
    }
    default:
      return null;
  }
};
