import { artistPhotoName as followArtistKey, deezerArtistCandidates } from "./artistPhoto.ts";

export interface DeezerFollowArtist {
  readonly name: string;
  readonly deezerId: number;
  readonly imageUrl: string | null;
  readonly fans: number;
}

/** null means no answer; an empty list is a successful search with no matches. */
export const deezerFollowArtists = (response: unknown): DeezerFollowArtist[] | null => {
  if (
    typeof response !== "object" ||
    response === null ||
    !("data" in response) ||
    !Array.isArray(response.data)
  )
    return null;
  return response.data.flatMap((row: unknown) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("id" in row) ||
      typeof row.id !== "number" ||
      !Number.isSafeInteger(row.id) ||
      row.id <= 0
    )
      return [];
    if ("type" in row && row.type !== "artist") return [];
    const artist = deezerArtistCandidates({ data: [row] })?.[0];
    if (artist === undefined || artist.name.trim() === "") return [];
    return [
      {
        name: artist.name,
        deezerId: row.id,
        imageUrl: artist.thumbUrl ?? artist.largeUrl,
        fans: artist.fans,
      },
    ];
  });
};

export interface FollowArtistSearchResult<A> {
  readonly key: string;
  readonly name: string;
  readonly library: A | null;
  readonly deezerId: number | null;
  readonly imageUrl: string | null;
}

/** Library matches keep their order and images. Namesakes share the most followed identity. */
export const mergeFollowArtistSearch = <A extends { readonly name: string }>(
  library: readonly A[],
  matches: readonly A[],
  online: readonly DeezerFollowArtist[],
): FollowArtistSearchResult<A>[] => {
  const locals = new Map(library.map((artist) => [followArtistKey(artist.name), artist]));
  const remote = new Map<string, DeezerFollowArtist>();
  for (const artist of online) {
    const key = followArtistKey(artist.name);
    const before = remote.get(key);
    if (before === undefined || artist.fans > before.fans) remote.set(key, artist);
  }
  const results = new Map<string, FollowArtistSearchResult<A>>();
  const add = (name: string) => {
    const key = followArtistKey(name);
    if (results.has(key)) return;
    const local = locals.get(key) ?? null;
    const artist = remote.get(key);
    results.set(key, {
      key,
      name: local?.name ?? name,
      library: local,
      deezerId: artist?.deezerId ?? null,
      imageUrl: local === null ? (artist?.imageUrl ?? null) : null,
    });
  };
  for (const artist of matches) add(artist.name);
  for (const artist of remote.values()) add(artist.name);
  return [...results.values()];
};

/**
 * The one line under Find artists to follow: searching, no answer from Deezer
 * (the Library's matches stay), or an answer with no matches. Null with no
 * query, or with matches to show and nothing else to say.
 */
export const followSearchLine = (
  state: {
    readonly query: string;
    /** Deezer hasn't answered this query yet. */
    readonly pending: boolean;
    /** Deezer gave no answer. */
    readonly failed: boolean;
    /** How many artists are listed. */
    readonly results: number;
  },
  strings: {
    readonly searching: string;
    readonly unavailable: string;
    readonly empty: string;
  },
): string | null => {
  if (state.query.trim() === "") return null;
  if (state.pending) return strings.searching;
  if (state.failed) return strings.unavailable;
  return state.results === 0 ? strings.empty : null;
};

/** ISO 3166's countries by two-letter code, as the Country choice for shows lists them. */
export const SHOW_COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ " +
  "BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM " +
  "DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS " +
  "GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
  "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ " +
  "MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM " +
  "PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV " +
  "SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
  "VN VU WF WS YE YT ZA ZM ZW"
).split(" ");
const showCountries = new Set(SHOW_COUNTRY_CODES);
/** Whether [value] is a country shows can be looked up in. */
export const isShowCountry = (value: unknown): value is string =>
  typeof value === "string" && showCountries.has(value);
