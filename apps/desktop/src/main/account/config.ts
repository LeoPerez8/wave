/**
 * Where this build's sync service is and which Google Desktop OAuth client it signs in with
 * (docs/agents/desktop-checks.md, Wave account). Both come from the build's environment
 * (electron-vite's `MAIN_VITE_*`, read by main only); an unpackaged run may point at another
 * service with `WAVE_*`. Without both there is no Sign In.
 */

export interface AccountConfig {
  /** The service's origin, or null when this build has no Wave account. */
  readonly syncUrl: string | null;
  readonly clientId: string | null;
  /** The Desktop client's secret, if Google asks for one; Google doesn't treat it as confidential. */
  readonly clientSecret: string | undefined;
}

type Env = Readonly<Record<string, string | undefined>>;

const value = (text: string | undefined): string | undefined => {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** [text] as an origin the session may go to: HTTPS, or a local service for an unpackaged run. */
const serviceOrigin = (text: string | undefined, packaged: boolean): string | null => {
  if (text === undefined) return null;
  try {
    const url = new URL(text);
    const secure =
      url.protocol === "https:" || (!packaged && url.protocol === "http:" && LOCAL.has(url.hostname));
    return secure ? url.origin : null;
  } catch {
    return null;
  }
};

export const accountConfig = (built: Env, runtime: Env, packaged: boolean): AccountConfig => {
  const pick = (name: string) =>
    (packaged ? undefined : value(runtime[`WAVE_${name}`])) ?? value(built[`MAIN_VITE_WAVE_${name}`]);
  const clientId = pick("GOOGLE_DESKTOP_CLIENT_ID") ?? null;
  const syncUrl = serviceOrigin(pick("SYNC_URL"), packaged);
  return {
    syncUrl: clientId === null ? null : syncUrl,
    clientId,
    clientSecret: pick("GOOGLE_DESKTOP_CLIENT_SECRET"),
  };
};
