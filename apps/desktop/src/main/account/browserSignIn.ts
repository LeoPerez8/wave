/**
 * Google's sign-in in the default browser (docs/spec-desktop.md, Sign-in): the Desktop OAuth
 * client's authorization code flow with PKCE, returning to a loopback address on a random port.
 * Gives the ID token Wave's sync service trades for a session; the code and the verifier never
 * leave the main process.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface BrowserSignInOptions {
  /** Google's authorization endpoint. */
  readonly authUrl: string;
  /** Google's token endpoint. */
  readonly tokenUrl: string;
  /** The Desktop OAuth client's id. */
  readonly clientId: string;
  /** The Desktop client's secret, when Google asks for it; Google doesn't treat it as confidential. */
  readonly clientSecret?: string;
  /** Opens [url] in the default browser. */
  readonly openExternal: (url: string) => Promise<void>;
  readonly fetch: typeof fetch;
  /** What the browser tab shows once Google sent it back. */
  readonly page: { readonly title: string; readonly message: string };
  /** How long to wait for the browser; 5 minutes by default. */
  readonly timeoutMs?: number;
  /** Cancel in Wave. */
  readonly signal?: AbortSignal;
}

/** Google's ID token and who it names, for display only: the service checks the token. */
export interface BrowserIdentity {
  readonly idToken: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly photoUrl: string | null;
}

/**
 * Why the browser sign-in ended without a token: backed out (on Google's page or with Cancel),
 * no answer in time, Google out of reach, or Google refused the code.
 */
export type BrowserSignInFailure = "cancelled" | "timeout" | "network" | "failed";

export class BrowserSignInError extends Error {
  readonly reason: BrowserSignInFailure;
  constructor(reason: BrowserSignInFailure) {
    super(`browser sign-in ${reason}`);
    this.reason = reason;
  }
}

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

const returnPage = ({ title, message }: BrowserSignInOptions["page"]): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
  `<meta name="viewport" content="width=device-width">` +
  `<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0}` +
  `@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style></head>` +
  `<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;

/** The claims of [idToken] Wave shows; the token's signature is the service's to check. */
const claimsOf = (idToken: string): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** Waits on a loopback server for Google's redirect: the code, or why there is none. */
const awaitRedirect = (
  options: BrowserSignInOptions,
  state: string,
  listening: (redirectUri: string) => void,
): Promise<{ code: string; redirectUri: string }> =>
  new Promise((resolve, reject) => {
    let redirectUri = "";
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", aborted);
      server.close();
      // Browsers keep the connection alive; the flow is over, so drop it.
      server.closeAllConnections();
      outcome();
    };
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", redirectUri);
      if (request.method !== "GET" || url.pathname !== "/") {
        response.writeHead(404).end();
        return;
      }
      // Another tab's or a stale redirect: not this sign-in's.
      if (url.searchParams.get("state") !== state) {
        response.writeHead(400).end();
        return;
      }
      const code = url.searchParams.get("code");
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "cache-control": "no-store",
        })
        .end(returnPage(options.page));
      finish(() =>
        code === null || code === ""
          ? reject(new BrowserSignInError("cancelled"))
          : resolve({ code, redirectUri }),
      );
    });
    const aborted = () => finish(() => reject(new BrowserSignInError("cancelled")));
    const timer = setTimeout(
      () => finish(() => reject(new BrowserSignInError("timeout"))),
      options.timeoutMs ?? 5 * 60_000,
    );
    if (options.signal?.aborted) return aborted();
    options.signal?.addEventListener("abort", aborted);
    server.on("error", () => finish(() => reject(new BrowserSignInError("failed"))));
    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      listening(redirectUri);
    });
  });

export const signInWithBrowser = async (
  options: BrowserSignInOptions,
): Promise<BrowserIdentity> => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  let opening: Promise<void> = Promise.resolve();
  const { code, redirectUri } = await awaitRedirect(options, state, (redirectUri) => {
    const url = new URL(options.authUrl);
    url.search = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      prompt: "select_account",
    }).toString();
    opening = options.openExternal(url.toString());
  });
  await opening.catch(() => {});
  let response: Response;
  try {
    response = await options.fetch(options.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: options.clientId,
        ...(options.clientSecret === undefined ? {} : { client_secret: options.clientSecret }),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }).toString(),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    if (options.signal?.aborted) throw new BrowserSignInError("cancelled");
    throw new BrowserSignInError("network");
  }
  const answer = (await response.json().catch(() => ({}))) as { id_token?: unknown };
  const idToken = text(answer.id_token);
  if (!response.ok || idToken === null) throw new BrowserSignInError("failed");
  const claims = claimsOf(idToken);
  return {
    idToken,
    email: text(claims["email"]),
    name: text(claims["name"]),
    photoUrl: text(claims["picture"]),
  };
};
