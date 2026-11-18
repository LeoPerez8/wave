/**
 * The update service's routes, over `UpdateStorage`, which R2 implements in production
 * (worker.ts) and memory in the tests. They answer GET only. The one write is the notes
 * history a read rebuilds from the stored notes; the binding itself can write and delete, so
 * that limit is this code's, not R2's. Each address gets a daily number of answers per route
 * (limits.ts). See README.md.
 */

import { versionOrder } from "@wave/core";

import {
  type Channel,
  type LatestUpdate,
  type NotesHistory,
  type ReleaseNotes,
  type SignedManifest,
  type StoredUpdate,
  assetKey,
  isChannel,
  latestApkKey,
  latestKey,
  notesHistoryKey,
  notesPrefix,
  updateKey,
} from "./layout.ts";
import {
  type CountKey,
  type CountedRoute,
  DAILY_LIMITS,
  DAILY_LIMIT_PER_ASSET,
  type RequestCounter,
  addressKey,
  assetCountKey,
  dayEndsAt,
  dayOf,
} from "./limits.ts";

export interface UpdateStorage {
  get(key: string): Promise<{
    readonly body: ReadableStream;
    text(): Promise<string>;
    readonly httpMetadata?: { readonly contentType?: string };
  } | null>;
  list(options: { prefix: string; cursor?: string }): Promise<
    {
      /** `uploaded` is when the object was written, which R2's listing carries. */
      readonly objects: readonly { readonly key: string; readonly uploaded: Date }[];
    } & ({ readonly truncated: true; readonly cursor: string } | { readonly truncated: false })
  >;
  /** Only the notes history is written here, when it's absent (`notesHistory`). */
  put(
    key: string,
    value: string,
    options: { readonly httpMetadata: { readonly contentType: string } },
  ): Promise<unknown>;
}

// The headers every answer to expo-updates' check carries; max-age=0 so a phone always asks.
const PROTOCOL_HEADERS = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

const BOUNDARY = "wave-update";

const noUpdate = (): Response => new Response(null, { status: 204, headers: PROTOCOL_HEADERS });
const refuse = (message: string): Response => new Response(message, { status: 400 });
const notFound = (): Response => new Response("Not found", { status: 404 });

const part = (name: string, body: string, signature?: string): string =>
  `--${BOUNDARY}\r\n` +
  `content-disposition: form-data; name="${name}"\r\n` +
  `content-type: application/json; charset=utf-8\r\n` +
  (signature === undefined ? "" : `expo-signature: ${signature}\r\n`) +
  `\r\n${body}\r\n`;

// The manifest goes out byte for byte as it was signed. expo-updates doesn't check the extensions.
const updateAnswer = ({ manifest, signature }: SignedManifest): string =>
  part("manifest", manifest, signature) +
  part("extensions", JSON.stringify({ assetRequestHeaders: {} })) +
  `--${BOUNDARY}--\r\n`;

const latestUpdate = async (
  storage: UpdateStorage,
  channel: Channel,
  runtimeVersion: string,
): Promise<StoredUpdate | null> => {
  const latest = await storage.get(latestKey(channel, runtimeVersion));
  if (!latest) return null;
  const { updateId } = JSON.parse(await latest.text()) as LatestUpdate;
  const update = await storage.get(updateKey(channel, runtimeVersion, updateId));
  if (!update) {
    console.error(`update service: ${channel}/${runtimeVersion} points to a missing ${updateId}`);
    return null;
  }
  return JSON.parse(await update.text()) as StoredUpdate;
};

const manifestRoute = async (request: Request, storage: UpdateStorage): Promise<Response> => {
  const header = (name: string) => request.headers.get(name) ?? "";
  if (header("expo-protocol-version") !== "1") return refuse("Unsupported protocol version");
  if (header("expo-platform") !== "android") return refuse("Unsupported platform");
  const channel = header("expo-channel-name");
  if (!isChannel(channel)) return refuse("Unknown channel");
  const runtimeVersion = header("expo-runtime-version");
  if (runtimeVersion === "") return refuse("No runtime version");

  const update = await latestUpdate(storage, channel, runtimeVersion);
  if (!update || update.id === header("expo-current-update-id")) return noUpdate();

  return new Response(updateAnswer(update.signed), {
    headers: { ...PROTOCOL_HEADERS, "content-type": `multipart/mixed; boundary=${BOUNDARY}` },
  });
};

const assetRoute = async (key: string, storage: UpdateStorage): Promise<Response> => {
  if (!/^[0-9a-f]{64}$/.test(key)) return notFound();
  const object = await storage.get(assetKey(key));
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      // Named by its content, so it never changes.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

/** Each release with notes on the channel, and when its notes file was written. */
const publishedVersions = async (
  storage: UpdateStorage,
  prefix: string,
): Promise<{ version: string; uploaded: Date }[]> => {
  const versions: { version: string; uploaded: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.list(cursor === undefined ? { prefix } : { prefix, cursor });
    for (const { key, uploaded } of page.objects)
      versions.push({ version: key.slice(prefix.length, -".json".length), uploaded });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return versions;
};

/** The channel's notes history built from each notes file: a read per release, so done once. */
const builtNotesHistory = async (
  storage: UpdateStorage,
  channel: Channel,
): Promise<NotesHistory> => {
  const prefix = notesPrefix(channel);
  const releases = await Promise.all(
    (await publishedVersions(storage, prefix)).map(async ({ version, uploaded }) => {
      const object = await storage.get(`${prefix}${version}.json`);
      if (!object) return [];
      const notes = JSON.parse(await object.text()) as ReleaseNotes;
      return [{ version, date: uploaded.toISOString(), notes }];
    }),
  );
  return releases.flat();
};

/**
 * The channel's notes history: the stored one, which publishing notes keeps current, in one read.
 * When it's absent or unreadable it's built from the notes files and stored for the next ask.
 */
const notesHistory = async (storage: UpdateStorage, channel: Channel): Promise<NotesHistory> => {
  const key = notesHistoryKey(channel);
  const stored = await storage.get(key);
  if (stored) {
    try {
      return JSON.parse(await stored.text()) as NotesHistory;
    } catch {
      console.error(`update service: ${key} can't be read, so it's built again`);
    }
  }
  const history = await builtNotesHistory(storage, channel);
  await storage.put(key, JSON.stringify(history), {
    httpMetadata: { contentType: "application/json" },
  });
  return history;
};

const notesRoute = async (url: URL, storage: UpdateStorage): Promise<Response> => {
  const channel = url.searchParams.get("channel") ?? "";
  if (!isChannel(channel)) return refuse("Unknown channel");
  // No `from` asks for the channel's whole history.
  const fromParam = url.searchParams.get("from");
  const from = fromParam === null ? Number.NEGATIVE_INFINITY : versionOrder(fromParam);
  if (from === null) return refuse("Not a version to count from");
  const toParam = url.searchParams.get("to");
  const to = toParam === null ? Number.POSITIVE_INFINITY : versionOrder(toParam);
  if (to === null) return refuse("Not a version to count up to");

  const releases = (await notesHistory(storage, channel))
    .map((release) => ({ release, order: versionOrder(release.version) ?? -1 }))
    .filter(({ order }) => order >= 0 && order > from && order <= to)
    .toSorted((a, b) => b.order - a.order)
    .map(({ release: { version, date, notes } }) => ({ version, date, notes }));
  return Response.json({ releases }, { headers: { "cache-control": "private, max-age=0" } });
};

const apkRoute = async (url: URL, storage: UpdateStorage): Promise<Response> => {
  const channel = url.searchParams.get("channel") ?? "";
  if (!isChannel(channel)) return refuse("Unknown channel");
  const object = await storage.get(latestApkKey(channel));
  if (!object) return notFound();
  return new Response(object.body, {
    headers: { "content-type": "application/json", "cache-control": "private, max-age=0" },
  });
};

/** The counted route a path belongs to, or null for one that's answered 404 at no cost. */
const routeOf = (pathname: string): CountedRoute | null => {
  if (pathname === "/v1/manifest") return "manifest";
  if (pathname === "/v1/notes") return "notes";
  if (pathname === "/v1/apk") return "apk";
  return /^\/v1\/assets\/[^/]+$/.test(pathname) ? "assets" : null;
};

/**
 * The answer once an address has had its answers for the day. The manifest's is the protocol's
 * "nothing new", which expo-updates takes as a finished check: the phone stays on what it runs
 * and checks again later. The other routes say to come back after the next UTC midnight.
 */
const pastLimit = (route: CountedRoute, now: number): Response => {
  const day = dayOf(now);
  const retryAfter = String(Math.max(1, Math.ceil((dayEndsAt(day) - now) / 1000)));
  if (route === "manifest") {
    return new Response(null, {
      status: 204,
      headers: { ...PROTOCOL_HEADERS, "retry-after": retryAfter },
    });
  }
  return new Response("Too many requests today", {
    status: 429,
    headers: { "retry-after": retryAfter, "cache-control": "private, max-age=0" },
  });
};

/** How many refusals an isolate remembers before it starts over. */
const REMEMBERED_REFUSALS = 10_000;

export interface UpdateServiceOptions {
  /** Counts each address's answers. Without one, nothing is counted. */
  readonly counter?: RequestCounter;
  readonly now?: () => number;
}

/** The service. Make one per isolate: it remembers who it refused today, so as not to ask again. */
export const createUpdateService = (
  storage: UpdateStorage,
  { counter, now = Date.now }: UpdateServiceOptions = {},
) => {
  /** `<address key> <count key>` to the day it was refused on. */
  const refused = new Map<string, string>();

  /** Whether the address may have one more under `key` today. A failing count lets it through. */
  const counted = async (
    counts: RequestCounter,
    address: string,
    key: CountKey,
    max: number,
  ): Promise<boolean> => {
    const day = dayOf(now());
    const remembered = `${address} ${key}`;
    if (refused.get(remembered) === day) return false;
    let within: boolean;
    try {
      within = await counts.count(address, key, day, max);
    } catch (error) {
      // What's served is public and signed: an outage of the counts mustn't stop updates.
      console.error(
        "update service: the request count failed:",
        error instanceof Error ? error.message : "unknown",
      );
      return true;
    }
    if (!within) {
      if (refused.size >= REMEMBERED_REFUSALS) refused.clear();
      refused.set(remembered, day);
    }
    return within;
  };

  /**
   * Whether the address may have this answer today: within its route's count and, for an asset,
   * within that asset's own. The route is counted first, so an address past it writes nothing.
   */
  const withinLimit = async (
    request: Request,
    route: CountedRoute,
    pathname: string,
  ): Promise<boolean> => {
    // Cloudflare sets it on every request that reaches the Worker; only the tests leave it out.
    // Kept only as a hash, and never logged.
    const address = request.headers.get("cf-connecting-ip");
    if (counter === undefined || address === null) return true;
    const key = await addressKey(address);
    if (!(await counted(counter, key, route, DAILY_LIMITS[route]))) return false;
    if (route !== "assets") return true;
    const asset = assetCountKey(pathname.slice("/v1/assets/".length));
    return asset === null || (await counted(counter, key, asset, DAILY_LIMIT_PER_ASSET));
  };

  return {
    fetch: async (request: Request): Promise<Response> => {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const url = new URL(request.url);
      const { pathname } = url;
      const route = routeOf(pathname);
      if (route === null) return notFound();
      if (!(await withinLimit(request, route, pathname))) return pastLimit(route, now());
      switch (route) {
        case "manifest":
          return manifestRoute(request, storage);
        case "notes":
          return notesRoute(url, storage);
        case "apk":
          return apkRoute(url, storage);
        case "assets":
          return assetRoute(pathname.slice("/v1/assets/".length), storage);
      }
    },
  };
};
