/**
 * The update pass (docs/spec.md, Build and CI): what a phone with a Wave account shows the update
 * service. The sync service signs it for a session, the app keeps it and sends it, and the update
 * service checks it with the public key alone, so neither Worker calls the other. A pass holds
 * its expiry and nothing else: no account, no email, no id.
 *
 * Signing and checking go through the Web Crypto global, which Workers and Node both have. The
 * app only keeps and sends a pass, so it needs none of that.
 */

/** The request header a pass travels in. */
export const UPDATE_PASS_HEADER = "wave-update-pass";
export const UPDATE_PASS_PLACEHOLDER = "none";
export const WAVE_UPDATES_ORIGIN = "https://wave-updates.leonardolp2424.workers.dev";

const DAY_MS = 24 * 60 * 60_000;

/** A pass lasts at least this many days, rounded up to the next UTC midnight. */
const LIFETIME_DAYS = 30;

/** The app asks for a new pass once the one it keeps has less than this left. */
const RENEW_BEFORE_MS = 15 * DAY_MS;

/** How long the app waits after an ask that brought no pass before it asks again. */
const RETRY_MS = 60 * 60_000;

/** A pass and when it stops counting, in milliseconds. */
export interface UpdatePass {
  readonly pass: string;
  readonly expiresAt: number;
}

/** A key as Web Crypto holds it. */
type PassKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const ALGORITHM = { name: "Ed25519" };

/** `1.<expiry in seconds>.<base64url of the 64-byte signature>`. */
const PASS = /^1\.([1-9]\d{0,11})\.([A-Za-z0-9_-]{85}[AQgw])$/;

/** The bytes a pass's signature covers. */
const signedBytes = (expirySeconds: number): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`${UPDATE_PASS_HEADER}.1.${expirySeconds}`);

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** A key's bytes from its PEM file, or from the base64 between the PEM's lines. */
const keyBytes = (text: string): Uint8Array<ArrayBuffer> =>
  fromBase64(text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));

/** The sync service's signing key: an Ed25519 private key as PKCS#8, in PEM or bare base64. */
export const importUpdatePassSigningKey = async (text: string): Promise<PassKey> =>
  crypto.subtle.importKey("pkcs8", keyBytes(text), ALGORITHM, false, ["sign"]);

/**
 * The update service's public keys: Ed25519 keys as SPKI, each in PEM or bare base64, separated
 * by commas. More than one lets the signing key be replaced while passes of the old one last.
 */
export const importUpdatePassPublicKeys = async (text: string): Promise<readonly PassKey[]> =>
  Promise.all(
    text
      .split(",")
      .filter((key) => key.trim() !== "")
      .map((key) => crypto.subtle.importKey("spki", keyBytes(key), ALGORITHM, false, ["verify"])),
  );

/**
 * A pass signed at [now]. It ends at the first UTC midnight more than 30 days away, and the
 * signature has no random part, so every pass signed on one day is the same text: nothing in it
 * tells one phone or account from another.
 */
export const issueUpdatePass = async (key: PassKey, now: number): Promise<UpdatePass> => {
  const expiresAt = (Math.floor(now / DAY_MS) + LIFETIME_DAYS + 1) * DAY_MS;
  const expirySeconds = expiresAt / 1000;
  const signature = new Uint8Array(
    await crypto.subtle.sign(ALGORITHM, key, signedBytes(expirySeconds)),
  );
  const encoded = btoa(String.fromCharCode(...signature))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return { pass: `1.${expirySeconds}.${encoded}`, expiresAt };
};

/** Whether [pass] is one of [keys]' passes and hasn't ended at [now]. Never throws. */
export const updatePassIsValid = async (
  keys: readonly PassKey[],
  pass: string,
  now: number,
): Promise<boolean> => {
  const match = PASS.exec(pass);
  if (match?.[1] === undefined || match[2] === undefined) return false;
  const expirySeconds = Number(match[1]);
  if (expirySeconds * 1000 <= now) return false;
  try {
    const signature = fromBase64(match[2].replaceAll("-", "+").replaceAll("_", "/"));
    const signed = signedBytes(expirySeconds);
    for (const key of keys) {
      if (await crypto.subtle.verify(ALGORITHM, key, signature, signed)) return true;
    }
  } catch {
    // Not a signature.
  }
  return false;
};

/**
 * The pass in the sync service's answer (`GET /v1/update-pass`), or in what the app kept of it.
 * Null when there's none, as from a service with no signing key.
 */
export const readUpdatePass = (answer: unknown): UpdatePass | null => {
  if (typeof answer !== "object" || answer === null) return null;
  const { pass, expiresAt } = answer as { readonly pass?: unknown; readonly expiresAt?: unknown };
  if (typeof pass !== "string" || typeof expiresAt !== "number") return null;
  const expirySeconds = PASS.exec(pass)?.[1];
  if (expirySeconds === undefined || Number(expirySeconds) * 1000 !== expiresAt) return null;
  return { pass, expiresAt };
};

/**
 * A signed-in phone renews when its pass has 15 days left or it has no pass.
 * If the last attempt brought no pass, wait an hour before trying again.
 */
export const updatePassNeedsRenewal = ({
  kept,
  lastAttemptAt,
  now,
}: {
  readonly kept: UpdatePass | null;
  /** When the app last asked without getting a pass; null after a pass or a sign-out. */
  readonly lastAttemptAt: number | null;
  readonly now: number;
}): boolean => {
  if (kept !== null && kept.expiresAt - now > RENEW_BEFORE_MS) return false;
  // A clock set back since the attempt doesn't hold the next one off.
  return lastAttemptAt === null || lastAttemptAt > now || now - lastAttemptAt >= RETRY_MS;
};

/** The header the app's own asks to the update service carry: the pass while it lasts, or none. */
export const updatePassHeaders = (
  kept: UpdatePass | null,
  now: number,
): Readonly<Record<string, string>> =>
  kept !== null && kept.expiresAt > now ? { [UPDATE_PASS_HEADER]: kept.pass } : {};

/**
 * The request headers `expo-updates` sends in place of the APK's own, or null to send the APK's.
 * An override replaces every header the APK declares, so it repeats the channel. Null with no
 * pass that still lasts, or no channel to repeat.
 */
export const updateRequestHeaders = ({
  channel,
  kept,
  now,
}: {
  readonly channel: string | null;
  readonly kept: UpdatePass | null;
  readonly now: number;
}): Readonly<Record<string, string>> | null => {
  const pass = updatePassHeaders(kept, now);
  if (channel === null || channel === "" || Object.keys(pass).length === 0) return null;
  return { "expo-channel-name": channel, ...pass };
};
