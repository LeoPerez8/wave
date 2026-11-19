import {
  artifactName,
  desktopFileKey,
  desktopLatestKey,
  desktopHistoryKey,
  desktopVersion,
} from "./desktopProtocol.ts";
import type { UpdateStorage } from "./service.ts";

export const desktopRouteOf = (pathname: string) => {
  const [, channel, tail] = /^\/v1\/desktop\/(ti|main)\/(.+)$/.exec(pathname) ?? [];
  if (channel !== "ti" && channel !== "main") return null;
  if (tail === "latest.json") return { key: desktopLatestKey(channel), kind: "desktop" } as const;
  if (tail === "history.json") return { key: desktopHistoryKey(channel), kind: "desktop" } as const;
  const [, version, digest, file] =
    /^files\/([^/]+)\/(?:([a-f0-9]{128})\/)?([^/]+)$/.exec(tail ?? "") ?? [];
  if (!version || !file || !desktopVersion(version, channel)) return null;
  const windows = artifactName("win32", version);
  if (
    digest
      ? file !== windows && file !== artifactName("linux", version)
      : file !== `${windows}.blockmap`
  ) {
    return null;
  }
  return { key: desktopFileKey(channel, version, file, digest), kind: "desktop-file" } as const;
};

export const serveDesktop = async (
  storage: UpdateStorage,
  route: NonNullable<ReturnType<typeof desktopRouteOf>>,
  range: string | null,
) => {
  const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range ?? "") ?? [];
  const offset = Number(start);
  const length = Number(end) - offset + 1;
  const partial = route.kind === "desktop-file" && range !== null;
  if (partial && (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 1)) {
    return new Response(null, { status: 416 });
  }
  const hit = await storage.get(route.key, partial ? { range: { offset, length } } : undefined);
  if (!hit) return new Response(null, { status: 404 });
  const headers = new Headers({
    "content-type": route.kind === "desktop" ? "application/json" : "application/octet-stream",
    "cache-control": "no-store",
  });
  if (partial) {
    if (hit.size === undefined || offset + length > hit.size) {
      await hit.body.cancel();
      return new Response(null, { status: 416 });
    }
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${hit.size}`);
    headers.set("content-length", String(length));
  } else if (hit.size !== undefined) {
    headers.set("content-length", String(hit.size));
  }
  return new Response(hit.body, { status: partial ? 206 : 200, headers });
};
