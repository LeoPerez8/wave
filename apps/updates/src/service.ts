/**
 * The update service's routes. They read from `UpdateStorage` only, which R2 implements in
 * production (worker.ts) and memory in the tests. See README.md.
 */

import { versionOrder } from "@wave/core";

import {
  type Channel,
  type LatestUpdate,
  type ReleaseNotes,
  type SignedManifest,
  type StoredUpdate,
  assetKey,
  isChannel,
  latestApkKey,
  latestKey,
  notesPrefix,
  updateKey,
} from "./layout.ts";

export interface UpdateStorage {
  get(key: string): Promise<{
    readonly body: ReadableStream;
    text(): Promise<string>;
    readonly httpMetadata?: { readonly contentType?: string };
  } | null>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<
    { readonly objects: readonly { readonly key: string }[] } & (
      { readonly truncated: true; readonly cursor: string } | { readonly truncated: false }
    )
  >;
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

const publishedVersions = async (storage: UpdateStorage, prefix: string): Promise<string[]> => {
  const versions: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.list(cursor === undefined ? { prefix } : { prefix, cursor });
    for (const { key } of page.objects) versions.push(key.slice(prefix.length, -".json".length));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return versions;
};

const notesRoute = async (url: URL, storage: UpdateStorage): Promise<Response> => {
  const channel = url.searchParams.get("channel") ?? "";
  if (!isChannel(channel)) return refuse("Unknown channel");
  const from = versionOrder(url.searchParams.get("from") ?? "");
  if (from === null) return refuse("No version to count from");
  const toParam = url.searchParams.get("to");
  const to = toParam === null ? Number.POSITIVE_INFINITY : versionOrder(toParam);
  if (to === null) return refuse("Not a version to count up to");

  const prefix = notesPrefix(channel);
  const between = (await publishedVersions(storage, prefix))
    .map((version) => ({ version, order: versionOrder(version) ?? -1 }))
    .filter(({ order }) => order > from && order <= to)
    .toSorted((a, b) => b.order - a.order);
  const releases = await Promise.all(
    between.map(async ({ version }) => {
      const object = await storage.get(`${prefix}${version}.json`);
      return object ? [{ version, notes: JSON.parse(await object.text()) as ReleaseNotes }] : [];
    }),
  );
  return Response.json(
    { releases: releases.flat() },
    { headers: { "cache-control": "private, max-age=0" } },
  );
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

export const createUpdateService = (storage: UpdateStorage) => ({
  fetch: async (request: Request): Promise<Response> => {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/v1/manifest") return manifestRoute(request, storage);
    if (pathname === "/v1/notes") return notesRoute(url, storage);
    if (pathname === "/v1/apk") return apkRoute(url, storage);
    const asset = /^\/v1\/assets\/([^/]+)$/.exec(pathname)?.[1];
    if (asset !== undefined) return assetRoute(asset, storage);
    return notFound();
  },
});
