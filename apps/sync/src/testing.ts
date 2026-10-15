/**
 * What the route tests share: a fresh libSQL database file with the
 * migrations run, a fake Google that signs ID tokens with a generated key and
 * serves it as a JWKS, and helpers to call the service as a phone would.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { type Client, createClient } from "@libsql/client";
import { GOOGLE_CERTS_URL } from "./google.ts";
import { type SyncLimits, SYNC_LIMITS } from "./limits.ts";
import { migrate } from "./migrations.ts";
import { type SyncServiceOptions, createSyncService } from "./service.ts";

const CLIENT_ID = "wave-web-client.apps.googleusercontent.com";

/** A `SOULSEEK_KEY` for the tests: base64 of 32 bytes. */
const SOULSEEK_KEY = Buffer.alloc(32, 7).toString("base64");

const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const base64urlJson = (value: unknown): string => base64url(encoder.encode(JSON.stringify(value)));

const generateKey = async (): Promise<CryptoKeyPair> =>
  (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

/** The claims a test's ID token carries; any can be overridden or left out (`undefined`). */
export interface TokenClaims {
  readonly [claim: string]: unknown;
}

/** A stand-in for Google: it signs ID tokens and serves its public key at Google's certs URL. */
export interface FakeGoogle {
  /** A signed ID token for [claims] over the defaults (a verified email, Wave's client id, valid for an hour). */
  readonly idToken: (claims?: TokenClaims) => Promise<string>;
  /** An ID token that names Google's key but is signed with another one. */
  readonly forgedIdToken: (claims?: TokenClaims) => Promise<string>;
  /** `fetch` as the service sees it: Google's certs URL answers the fake JWKS. */
  readonly fetch: typeof fetch;
  /** How many times the certs were fetched. */
  readonly certFetches: () => number;
}

const KID = "test-key-1";

const fakeGoogle = async (now: () => number): Promise<FakeGoogle> => {
  const key = await generateKey();
  const forger = await generateKey();
  const jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
  let fetches = 0;

  const sign = async (privateKey: CryptoKey, claims: TokenClaims = {}): Promise<string> => {
    const seconds = Math.floor(now() / 1000);
    const payload = Object.fromEntries(
      Object.entries({
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        sub: "google-sub-1",
        email: "ana@example.com",
        email_verified: true,
        iat: seconds,
        exp: seconds + 3600,
        ...claims,
      }).filter(([, value]) => value !== undefined),
    );
    const head = `${base64urlJson({ alg: "RS256", kid: KID, typ: "JWT" })}.${base64urlJson(payload)}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      encoder.encode(head),
    );
    return `${head}.${base64url(new Uint8Array(signature))}`;
  };

  return {
    idToken: (claims) => sign(key.privateKey, claims),
    forgedIdToken: (claims) => sign(forger.privateKey, claims),
    fetch: async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== GOOGLE_CERTS_URL) return new Response("not found", { status: 404 });
      fetches++;
      return Response.json(
        { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] },
        { headers: { "cache-control": "public, max-age=3600" } },
      );
    },
    certFetches: () => fetches,
  };
};

/** A fresh database file, deleted when the test file ends. */
const freshDatabase = async (): Promise<Client> => {
  const dir = mkdtempSync(join(tmpdir(), "wave-sync-"));
  const db = createClient({ url: `file:${join(dir, "sync.db").replaceAll("\\", "/")}` });
  after(() => {
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can hold the file a moment after closing; it's a temp dir.
    }
  });
  await migrate(db);
  return db;
};

/** A running service over a fresh database, with a clock the test moves. */
export interface Harness {
  readonly db: Client;
  readonly google: FakeGoogle;
  /** The service's clock, in ms since the epoch. */
  now: number;
  /** Calls the service. */
  readonly request: (method: string, path: string, init?: RequestOptions) => Promise<Response>;
  /** Signs in with an ID token for [claims] and gives the session token. */
  readonly signIn: (claims?: TokenClaims) => Promise<string>;
}

export interface RequestOptions {
  readonly session?: string;
  readonly json?: unknown;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface HarnessOptions {
  readonly allowedEmails?: string;
  readonly limits?: Partial<SyncLimits>;
  readonly pullPageSize?: number;
  /** `SOULSEEK_KEY`; `SOULSEEK_KEY` above by default, null for none. */
  readonly soulseekKey?: string | null;
}

export const harness = async (options: HarnessOptions = {}, db?: Client): Promise<Harness> => {
  db ??= await freshDatabase();
  const state = { now: Date.UTC(2026, 9, 14, 12) };
  const clock = (): number => state.now;
  const google = await fakeGoogle(clock);
  const serviceOptions: SyncServiceOptions = {
    db,
    googleClientId: CLIENT_ID,
    fetch: google.fetch,
    now: clock,
    limits: { ...SYNC_LIMITS, ...options.limits },
    ...(options.allowedEmails === undefined ? {} : { allowedEmails: options.allowedEmails }),
    ...(options.pullPageSize === undefined ? {} : { pullPageSize: options.pullPageSize }),
    ...(options.soulseekKey === null ? {} : { soulseekKey: options.soulseekKey ?? SOULSEEK_KEY }),
  };
  const service = createSyncService(serviceOptions);

  const request = (method: string, path: string, init: RequestOptions = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (init.session !== undefined) headers.set("authorization", `Bearer ${init.session}`);
    let body: string | undefined = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers.set("content-type", "application/json");
    }
    return service(
      new Request(`https://sync.wave.test${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      }),
    );
  };

  const signIn = async (claims?: TokenClaims): Promise<string> => {
    const response = await request("POST", "/v1/session", {
      json: { idToken: await google.idToken(claims) },
    });
    if (response.status !== 200) throw new Error(`sign-in answered ${response.status}`);
    const { sessionToken } = (await response.json()) as { sessionToken: string };
    return sessionToken;
  };

  return {
    db,
    google,
    get now(): number {
      return state.now;
    },
    set now(value: number) {
      state.now = value;
    },
    request,
    signIn,
  };
};

/** A row as the service answers it. */
export type PulledRow = Readonly<Record<string, unknown>> & { readonly id: string };

/** What `GET /v1/pull` answers. */
export interface Pulled {
  readonly songs: readonly PulledRow[];
  readonly playlists: readonly PulledRow[];
  readonly playlistEntries: readonly PulledRow[];
  readonly favorites: readonly PulledRow[];
  readonly preferences: readonly PulledRow[];
  readonly plays: readonly PulledRow[];
  readonly cursor: string;
  readonly more: boolean;
}

/** Pushes [body] and fails the test unless it's accepted. */
export const push = async (
  service: Harness,
  session: string,
  body: unknown,
): Promise<Readonly<Record<string, unknown>>> => {
  const response = await service.request("POST", "/v1/push", { session, json: body });
  const answer = (await response.json()) as Readonly<Record<string, unknown>>;
  if (response.status !== 200) {
    throw new Error(`push answered ${response.status}: ${JSON.stringify(answer)}`);
  }
  return answer;
};

/** Pulls one page after [since] and fails the test unless it's answered. */
export const pull = async (service: Harness, session: string, since?: string): Promise<Pulled> => {
  const query = since === undefined ? "" : `?since=${encodeURIComponent(since)}`;
  const response = await service.request("GET", `/v1/pull${query}`, { session });
  if (response.status !== 200) throw new Error(`pull answered ${response.status}`);
  return (await response.json()) as Pulled;
};

/** Every page after [since], joined. */
export const pullAll = async (
  service: Harness,
  session: string,
  since?: string,
): Promise<Pulled & { readonly pages: number }> => {
  const joined: Record<string, PulledRow[]> = {};
  let cursor = since;
  let pages = 0;
  for (;;) {
    const page = await pull(service, session, cursor);
    pages++;
    for (const [key, value] of Object.entries(page)) {
      if (Array.isArray(value)) (joined[key] ??= []).push(...(value as PulledRow[]));
    }
    cursor = page.cursor;
    if (!page.more) return { ...(joined as unknown as Pulled), cursor, more: false, pages };
  }
};

/** How many sessions the database holds. */
export const sessionCount = async (service: Harness): Promise<number> =>
  Number((await service.db.execute("SELECT count(*) AS n FROM sessions")).rows[0]?.n);

/** A favorite row. */
export const favorite = (
  id: string,
  changedAt: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  id,
  changedAt,
  phoneId: "phone-a",
  deleted: false,
  addedAt: changedAt,
  ...overrides,
});
