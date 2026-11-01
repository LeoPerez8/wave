/**
 * The update service's routes. They read from `UpdateStorage` only, which R2 implements in
 * production (worker.ts) and memory in the tests. See README.md.
 */

import {
  type Channel,
  type LatestUpdate,
  type SignedManifest,
  type StoredUpdate,
  assetKey,
  isChannel,
  latestKey,
  updateKey,
} from "./layout.ts";

export interface UpdateStorage {
  get(key: string): Promise<{
    readonly body: ReadableStream;
    text(): Promise<string>;
    readonly httpMetadata?: { readonly contentType?: string };
  } | null>;
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

export const createUpdateService = (storage: UpdateStorage) => ({
  fetch: async (request: Request): Promise<Response> => {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const { pathname } = new URL(request.url);
    if (pathname === "/v1/manifest") return manifestRoute(request, storage);
    const asset = /^\/v1\/assets\/([^/]+)$/.exec(pathname)?.[1];
    if (asset !== undefined) return assetRoute(asset, storage);
    return notFound();
  },
});
