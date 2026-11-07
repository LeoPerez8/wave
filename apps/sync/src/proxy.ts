/**
 * What the service's provider routes share (Genius now): one fixed request to
 * a provider, answered from Cloudflare's cache when another phone asked it
 * lately, and otherwise from the provider, with the Worker's own key. An
 * answer is cached by the provider request alone, never by the account that
 * asked. Only a successful JSON answer gets through: anything else, the
 * provider's error body included, is the caller's failure.
 *
 * Nothing here logs: a request names a song or an artist.
 */

/** The part of Cloudflare's Cache API the proxy uses (`caches.default`), or a stand-in in the tests. */
export interface ProxyCache {
  readonly match: (key: string) => Promise<Response | undefined>;
  readonly put: (key: string, response: Response) => Promise<void>;
}

/** How the proxy reaches the providers and the cache: the Worker's `fetch` and `caches.default`. */
export interface Upstream {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly cache: ProxyCache | null;
}

/** One request to a provider, as the service makes it. */
export interface UpstreamRequest {
  /** What the provider is asked, the key included when it goes in the URL. */
  readonly url: string;
  /** What the request is cached by: the provider request without any key. */
  readonly cacheKey: string;
  readonly headers: Readonly<Record<string, string>>;
  /** How long its answer is kept for other phones. */
  readonly ttlSeconds: number;
  /** Values an answer may never hold (the provider's key). */
  readonly secrets: readonly string[];
}

/** What a provider answered: its JSON as text, or a failure (with its status when it answered). */
export type UpstreamResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly status: number | null };

/** What the proxy names itself to providers. */
export const PROXY_USER_AGENT = "Wave (https://github.com/LeoPerez8/wave)";

/** A provider request that takes longer than this has failed. */
const UPSTREAM_TIMEOUT_MS = 10_000;

const sha256Hex = async (text: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * Where [request]'s answer is cached: a URL on the service's own [origin]
 * (the Cache API keeps entries by URL), named by a hash of the provider
 * request, so the key holds no song or artist.
 */
const cacheUrl = async (origin: string, request: UpstreamRequest): Promise<string> =>
  `${origin}/upstream-cache/${await sha256Hex(request.cacheKey)}`;

/** Whether [text] holds any of [secrets], as is, URL-encoded or JSON-escaped. */
const holdsSecret = (text: string, secrets: readonly string[]): boolean =>
  secrets.some(
    (secret) =>
      secret !== "" &&
      [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)].some((form) =>
        text.includes(form),
      ),
  );

/** [request]'s answer kept by another request lately; null when there's none or the cache fails. */
export const cachedAnswer = async (
  upstream: Upstream,
  origin: string,
  request: UpstreamRequest,
): Promise<string | null> => {
  if (upstream.cache === null) return null;
  try {
    const hit = await upstream.cache.match(await cacheUrl(origin, request));
    return hit === undefined ? null : await hit.text();
  } catch {
    return null;
  }
};

/**
 * Asks the provider [request], with no redirect followed: its body when it
 * answered 200 with JSON that holds none of [request]'s secrets, a failure
 * otherwise. Never rejects.
 */
export const askUpstream = async (
  upstream: Upstream,
  request: UpstreamRequest,
): Promise<UpstreamResult> => {
  let response: Response;
  try {
    response = await upstream.fetch(request.url, {
      headers: { "user-agent": PROXY_USER_AGENT, ...request.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: null };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, status: response.status };
  }
  try {
    const body = await response.text();
    JSON.parse(body);
    if (holdsSecret(body, request.secrets)) return { ok: false, status: response.status };
    return { ok: true, body };
  } catch {
    return { ok: false, status: response.status };
  }
};

/** Keeps [body] as [request]'s answer for its time; a cache that fails only costs a later request. */
export const keepAnswer = async (
  upstream: Upstream,
  origin: string,
  request: UpstreamRequest,
  body: string,
): Promise<void> => {
  if (upstream.cache === null) return;
  try {
    await upstream.cache.put(
      await cacheUrl(origin, request),
      new Response(body, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${request.ttlSeconds}`,
        },
      }),
    );
  } catch {
    // Nothing to do: the next phone asks the provider.
  }
};

/** A provider's answer as the service gives it to the phone: the JSON alone, kept by nobody on the way. */
export const proxiedAnswer = (body: string): Response =>
  new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
