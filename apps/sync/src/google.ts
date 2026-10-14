/**
 * Checking a Google ID token (docs/spec.md, "Signing in"): its RS256
 * signature against Google's published keys, its issuer, its audience
 * against Wave's web client id and its expiry. Nothing here logs a token.
 */

export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/** How far the token's expiry may be behind the service's clock, as Google's own libraries allow. */
const CLOCK_SKEW_MS = 5 * 60_000;

/** How long Google's keys are kept when the answer doesn't say. */
const DEFAULT_KEYS_TTL_MS = 60 * 60_000;

/** How often an unknown key id may refetch the keys (Google rotates them; a forged id mustn't hammer it). */
const REFETCH_INTERVAL_MS = 60_000;

/** Who a valid ID token says signed in. */
export interface GoogleIdentity {
  /** Google's stable id for the account. */
  readonly sub: string;
  readonly email: string;
}

/** Google's signing keys, by key id. */
export interface GoogleKeys {
  readonly key: (kid: string) => Promise<CryptoKey | null>;
}

const maxAgeMs = (cacheControl: string | null): number => {
  const match = /max-age=(\d+)/.exec(cacheControl ?? "");
  return match?.[1] === undefined ? DEFAULT_KEYS_TTL_MS : Number(match[1]) * 1000;
};

interface Jwk extends JsonWebKey {
  readonly kid?: string;
}

/** Google's keys fetched from its JWKS with [fetchFn], kept as long as its answer allows. */
export const googleKeys = (fetchFn: typeof fetch, now: () => number): GoogleKeys => {
  let keys = new Map<string, CryptoKey>();
  let expiresAt = 0;
  let fetchedAt = Number.NEGATIVE_INFINITY;

  const refresh = async (): Promise<void> => {
    fetchedAt = now();
    const response = await fetchFn(GOOGLE_CERTS_URL);
    if (!response.ok) throw new Error(`Google's keys answered ${response.status}`);
    const body = (await response.json()) as { keys?: readonly Jwk[] };
    const next = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kid === undefined || jwk.kty !== "RSA") continue;
      const { kid, ...rest } = jwk;
      next.set(
        kid,
        await crypto.subtle.importKey(
          "jwk",
          rest,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      );
    }
    keys = next;
    expiresAt = fetchedAt + maxAgeMs(response.headers.get("cache-control"));
  };

  return {
    key: async (kid) => {
      const stale = now() >= expiresAt;
      if (stale || (!keys.has(kid) && now() - fetchedAt >= REFETCH_INTERVAL_MS)) await refresh();
      return keys.get(kid) ?? null;
    },
  };
};

const base64urlBytes = (text: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const base64urlJson = (text: string): unknown => {
  const bytes = base64urlBytes(text);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Who [token] says signed in, or `null` when it isn't a valid Google ID token
 * for [clientId]: a bad signature, another issuer or audience, expired, or
 * an unverified email.
 */
export const verifyGoogleIdToken = async (
  token: string,
  options: { readonly clientId: string; readonly keys: GoogleKeys; readonly now: () => number },
): Promise<GoogleIdentity | null> => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;
  const header = base64urlJson(headerPart);
  const payload = base64urlJson(payloadPart);
  const signature = base64urlBytes(signaturePart);
  if (!isRecord(header) || !isRecord(payload) || signature === null) return null;
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const key = await options.keys.key(header.kid);
  if (key === null) return null;
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed))) return null;

  if (typeof payload.iss !== "string" || !ISSUERS.has(payload.iss)) return null;
  if (payload.aud !== options.clientId) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 + CLOCK_SKEW_MS <= options.now()) {
    return null;
  }
  if (typeof payload.sub !== "string" || payload.sub === "") return null;
  if (typeof payload.email !== "string" || payload.email_verified !== true) return null;
  return { sub: payload.sub, email: payload.email };
};
