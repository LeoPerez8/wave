/**
 * Whether Android lets Wave open the song links it declares (docs/spec.md,
 * "Opening a song link"): Wave doesn't own those domains, so from Android 12
 * a tapped link opens in Wave only for the hosts the owner turned on in
 * Android's Open by default page for Wave. Settings › Accounts' "Open song
 * links in Wave" row says which, from Android's domain verification user
 * state.
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";

/**
 * A host's state in Android's `DomainVerificationUserState`
 * (`DOMAIN_STATE_*`): not opened by Wave, selected by the owner in Open by
 * default, or verified for Wave by Android.
 */
const DOMAIN_STATE = { none: 0, selected: 1, verified: 2 } as const;

/** The states in which a host's links open in Wave. */
const OPENS_IN_WAVE: ReadonlySet<number> = new Set([DOMAIN_STATE.selected, DOMAIN_STATE.verified]);

/**
 * Android's domain verification user state for Wave: whether "Open supported
 * links" is on, and each web host Wave's intent filters declare with its
 * state (`DOMAIN_STATE`, as Android numbers it).
 */
export type SongLinkHandlingState = {
  readonly allowed: boolean;
  readonly hosts: Readonly<Record<string, number>>;
};

/** Every declared host opens in Wave, some do, or none. */
export type SongLinkHandling = "all" | "some" | "none";

/** Selected and verified hosts open in Wave; with "Open supported links" off, none does. */
export const songLinkHandling = ({ allowed, hosts }: SongLinkHandlingState): SongLinkHandling => {
  const states = Object.values(hosts);
  const on = allowed ? states.filter((state) => OPENS_IN_WAVE.has(state)).length : 0;
  if (on === 0) return "none";
  return on === states.length ? "all" : "some";
};

/** The row's line under "Open song links in Wave". */
export const songLinkHandlingLine = (
  handling: SongLinkHandling,
  language: AppLanguage = "en",
): string => {
  const text = catalogueOf(language).settings;
  switch (handling) {
    case "all":
      return text.songLinksAll;
    case "some":
      return text.songLinksSome;
    case "none":
      return text.songLinksNone;
  }
};

/** The song-link services whose own apps may hold their links. */
export type SongLinkService = "youtubeMusic" | "spotify" | "deezer";

const SERVICES: readonly SongLinkService[] = ["youtubeMusic", "spotify", "deezer"];

/**
 * The links Wave asks Android about (`WaveNative.songLinkOpeners`): a song on
 * each service, and a plain web page, which opens in the browser. Their hosts
 * are in wave-native's manifest `<queries>`, so Android lets Wave see the apps
 * that open them.
 */
export const SONG_LINK_SAMPLES: Readonly<Record<SongLinkService | "web", string>> = {
  youtubeMusic: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
  spotify: "https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8",
  deezer: "https://www.deezer.com/track/3135556",
  web: "https://example.com/",
};

/** The app Android would open a link in now. */
export type SongLinkOpener = { readonly packageName: string; readonly label: string };

/**
 * What Android would open each sample link in (`SONG_LINK_SAMPLES`), null when
 * it would ask, open Wave itself, or has nothing: `web` is a plain web page's,
 * the browser.
 */
export type SongLinkOpeners = Readonly<
  Partial<Record<SongLinkService | "web", SongLinkOpener | null>>
>;

/** A step before Wave's own Turn On: turn the links off in the app that holds them. */
export type SongLinkTurnOff = {
  readonly service: SongLinkService;
  readonly packageName: string;
  readonly step: string;
  readonly button: string;
};

/** Card 2's and the Settings row's steps and result line. */
export type SongLinkSetup = {
  readonly handling: SongLinkHandling;
  readonly line: string;
  readonly turnOff: readonly SongLinkTurnOff[];
};

/** The services whose link opens in an app other than the browser, which holds their links. */
const heldServices = (openers: SongLinkOpeners | null) =>
  SERVICES.flatMap((service) => {
    const opener = openers?.[service];
    if (!opener || opener.packageName === openers?.web?.packageName) return [];
    return [{ service, opener }];
  });

/** A host Wave has on still doesn't open in Wave while another app holds it. */
const handlingWithHeld = (state: SongLinkHandlingState, held: number): SongLinkHandling => {
  const own = songLinkHandling(state);
  return own === "all" && held > 0 ? "some" : own;
};

/** `songLinkSetup`'s handling alone, for a caller that shows none of its lines. */
export const songLinkSetupHandling = (
  state: SongLinkHandlingState,
  openers: SongLinkOpeners | null,
): SongLinkHandling => handlingWithHeld(state, heldServices(openers).length);

/**
 * Wave's own host state plus the app each service's link opens in: a service
 * whose link opens in an app other than the browser has its links held there.
 */
export const songLinkSetup = (
  state: SongLinkHandlingState,
  openers: SongLinkOpeners | null,
  language: AppLanguage = "en",
): SongLinkSetup => {
  const text = catalogueOf(language).settings;
  const held = heldServices(openers).map(({ service, opener }) => ({
    service,
    opener,
    line: text.songLinksHeldBy(opener.label, text.songLinkServices[service]),
  }));
  const turnOff = held.map(({ service, opener, line }) => ({
    service,
    packageName: opener.packageName,
    step: `${line} ${text.songLinksTurnOffFirst}`,
    button: text.turnOffIn(opener.label),
  }));
  const handling = handlingWithHeld(state, held.length);
  const line = [...held.map((entry) => entry.line), songLinkHandlingLine(handling, language)].join(
    " ",
  );
  return { handling, line, turnOff };
};
