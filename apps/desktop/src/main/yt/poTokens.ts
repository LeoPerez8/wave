/**
 * Proof-of-origin tokens for YouTube Music's web client, the desktop twin of the phone's
 * `YtPoTokens` and `YtPoTokenWebView`: BotGuard runs in a hidden page (`wave_po_token.html`)
 * that loads nothing itself; main fetches BotGuard's challenge and integrity token and hands
 * them in. Once set up, the page mints a token per identifier (the visitor data, a video id)
 * until its integrity token runs out. The JVM asks for them with `poToken`.
 *
 * Tokens are the session's: never logged.
 */

/** BotGuard's endpoints, as YouTube's web player calls them. */
const CREATE_URL = "https://www.youtube.com/api/jnn/v1/Create";
const GENERATE_IT_URL = "https://www.youtube.com/api/jnn/v1/GenerateIT";
// BotGuard's public web key and request key, as YouTube's web player sends them (and as the
// phone's YtPoTokenWebView does).
const GOOGLE_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
export const PO_TOKEN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.3";

/** Set-up makes two round trips to BotGuard and runs its program. */
const SET_UP_TIMEOUT_MS = 45_000;
/** A live page mints a token in well under a second. */
const MINT_TIMEOUT_MS = 15_000;

/** The hidden page BotGuard runs in. */
export interface PoTokenPage {
  /** Runs `script` in the page and answers its (awaited) value. */
  readonly run: (script: string) => Promise<unknown>;
  /** Its renderer died or BotGuard threw after set-up. */
  readonly dead: () => boolean;
  readonly close: () => void;
}

export interface PoTokenDeps {
  /** A new page, with `wave_po_token.html` loaded and the network blocked. */
  readonly openPage: () => Promise<PoTokenPage>;
  /** POSTs `body` to BotGuard and answers the body, or rejects. */
  readonly post: (url: string, body: string) => Promise<string>;
  readonly now?: () => number;
}

/** YouTube's base64: either alphabet, `.` for padding, padding optional. */
const fromBase64 = (text: string): Buffer =>
  Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "="), "base64");

const firstString = (value: unknown): string | null =>
  Array.isArray(value)
    ? ((value.find((item) => typeof item === "string") as string) ?? null)
    : null;

/** The challenge `Create` answers, as the page's `runBotGuard` takes it. */
export const challengeData = (raw: string) => {
  const outer = JSON.parse(raw) as unknown[];
  const scrambled = outer[1];
  const challenge = (
    typeof scrambled === "string"
      ? JSON.parse(Buffer.from(fromBase64(scrambled).map((byte) => byte + 97)).toString())
      : outer[0]
  ) as unknown[];
  const field = (index: number) => String(challenge[index]);
  return {
    messageId: field(0),
    interpreterJavascript: {
      privateDoNotAccessOrElseSafeScriptWrappedValue: firstString(challenge[1]),
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: firstString(challenge[2]),
    },
    interpreterHash: field(3),
    program: field(4),
    globalName: field(5),
    clientExperimentsStateBlob: field(7),
  };
};

/** The integrity token `GenerateIT` answers, as bytes, and how many seconds it lasts. */
export const integrityToken = (raw: string) => {
  const [token, lifetime] = JSON.parse(raw) as [unknown, unknown];
  if (typeof token !== "string" || typeof lifetime !== "number")
    throw new Error("BotGuard sent no integrity token");
  return { bytes: [...fromBase64(token)], lifetimeSeconds: lifetime };
};

/** A token the minter returned, in the base64 YouTube expects (URL-safe, padded). */
export const tokenText = (bytes: readonly number[]): string =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

const uint8Array = (bytes: readonly number[]) => `new Uint8Array([${bytes.join(",")}])`;

const within = <A>(ms: number, what: string, work: Promise<A>): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

interface Minter {
  readonly page: PoTokenPage;
  readonly visitor: string;
  readonly visitorToken: string;
  readonly expiresAtMs: number;
}

export interface PoTokens {
  /** A token for each identifier: the visitor data first, then the video id. */
  readonly mint: (identifiers: readonly string[]) => Promise<string[]>;
  readonly close: () => void;
}

export const createPoTokens = (deps: PoTokenDeps): PoTokens => {
  const now = deps.now ?? Date.now;
  let minter: Promise<Minter> | undefined;

  const post = (url: string, body: unknown) => deps.post(url, JSON.stringify(body));

  const mintWith = async (page: PoTokenPage, identifier: string) => {
    const script = `obtainPoToken(${uint8Array([...Buffer.from(identifier)])}).then(function (token) { return Array.from(token) })`;
    const bytes = await within(MINT_TIMEOUT_MS, "Minting", page.run(script));
    if (!Array.isArray(bytes) || !bytes.every((byte) => Number.isInteger(byte)))
      throw new Error("The page minted no token");
    return tokenText(bytes as number[]);
  };

  const setUp = async (visitor: string): Promise<Minter> => {
    const page = await deps.openPage();
    try {
      return await within(
        SET_UP_TIMEOUT_MS,
        "Set-up",
        (async () => {
          const challenge = challengeData(await post(CREATE_URL, [REQUEST_KEY]));
          const response = await page.run(
            `runBotGuard(${JSON.stringify(challenge)}).then(function (result) { window.webPoSignalOutput = result.webPoSignalOutput; return result.botguardResponse })`,
          );
          if (typeof response !== "string") throw new Error("BotGuard gave no response");
          const integrity = integrityToken(await post(GENERATE_IT_URL, [REQUEST_KEY, response]));
          // Ten minutes early, to be safe.
          const expiresAtMs = now() + Math.max(0, integrity.lifetimeSeconds - 600) * 1000;
          await page.run(
            `createPoTokenMinter(window.webPoSignalOutput, ${uint8Array(integrity.bytes)}).then(function () { return true })`,
          );
          // The visitor-bound token comes first, before any other is minted.
          const visitorToken = await mintWith(page, visitor);
          return { page, visitor, visitorToken, expiresAtMs };
        })(),
      );
    } catch (error) {
      page.close();
      throw error;
    }
  };

  /** The live minter for `visitor`, set up again when it can't serve. */
  const current = async (visitor: string): Promise<Minter> => {
    const pending = minter;
    if (pending !== undefined) {
      const ready = await pending.catch(() => undefined);
      if (
        ready !== undefined &&
        ready.visitor === visitor &&
        now() < ready.expiresAtMs &&
        !ready.page.dead()
      )
        return ready;
      // Another ask may have started over meanwhile.
      if (minter !== pending) return current(visitor);
      ready?.page.close();
    }
    const fresh = setUp(visitor);
    minter = fresh;
    fresh.catch(() => {
      if (minter === fresh) minter = undefined;
    });
    return fresh;
  };

  return {
    mint: async (identifiers) => {
      const [visitor, ...rest] = identifiers;
      if (visitor === undefined) return [];
      const ready = await current(visitor);
      try {
        const tokens = [ready.visitorToken];
        for (const identifier of rest) tokens.push(await mintWith(ready.page, identifier));
        return tokens;
      } catch (error) {
        // A page that can't mint is wedged: the next ask starts over.
        ready.page.close();
        if (minter !== undefined && (await minter.catch(() => undefined)) === ready)
          minter = undefined;
        throw error;
      }
    },
    close: () => {
      void minter?.then((ready) => ready.page.close()).catch(() => undefined);
      minter = undefined;
    },
  };
};

/** BotGuard's headers for a `post`. */
export const BOTGUARD_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": PO_TOKEN_USER_AGENT,
  Accept: "application/json",
  "Content-Type": "application/json+protobuf",
  "x-goog-api-key": GOOGLE_API_KEY,
  "x-user-agent": "grpc-web-javascript/0.1",
};

/** The JVM's `poToken` call: `{identifiers: [visitorData, videoId?]}` -> `{tokens}`. */
export const poTokenHost =
  (tokens: Pick<PoTokens, "mint">) =>
  async (params: unknown): Promise<{ tokens: string[] }> => {
    const identifiers = (params as { identifiers?: unknown } | null)?.identifiers;
    if (
      !Array.isArray(identifiers) ||
      identifiers.length < 1 ||
      identifiers.length > 2 ||
      !identifiers.every(
        (identifier) =>
          typeof identifier === "string" && identifier !== "" && identifier.length <= 2_000,
      )
    )
      throw new Error("poToken wants one or two identifiers");
    return { tokens: await tokens.mint(identifiers as string[]) };
  };

/** POSTs to BotGuard as YouTube's web player does, without cookies. */
export const botguardPost =
  (fetchFn: typeof globalThis.fetch = globalThis.fetch) =>
  async (url: string, body: string): Promise<string> => {
    const response = await fetchFn(url, {
      method: "POST",
      headers: BOTGUARD_HEADERS,
      body,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`BotGuard answered ${response.status}`);
    return response.text();
  };
