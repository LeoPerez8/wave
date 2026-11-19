import { open, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readVersionHistory, type DatedRelease } from "@wave/core";
import { VERSION_HISTORY_PAGE_SIZE, type DesktopVersionHistory } from "../../shared/bridge.ts";
import {
  compareDesktopVersions,
  desktopHistoryKey,
  desktopVersion,
  type DesktopChannel,
} from "../../../../updates/src/desktopProtocol.ts";
import { UPDATES_ORIGIN } from "../../../../updates/src/layout.ts";

const MAX_HISTORY_BYTES = 4 * 1024 * 1024;

const readResponse = async (response: Response, maxBytes: number): Promise<string> => {
  if (!response.ok || !response.body) throw new Error("Version history unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Version history is too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
};

export const createDesktopVersionHistory = ({
  version,
  channel,
  folder,
  maxBytes = MAX_HISTORY_BYTES,
  fetchHistory = (url: string) =>
    fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }),
}: {
  version: string;
  channel: DesktopChannel | null;
  folder: string;
  maxBytes?: number;
  fetchHistory?: (url: string) => Promise<Response>;
}) => {
  const cache = join(folder, `desktop-versions-${channel}.json`);
  let kept: string | undefined;
  let releases: readonly DatedRelease[] | null = null;
  let currentListed = false;
  let loading: Promise<void> | undefined;
  const accept = (text: string) => {
    if (text === kept) return;
    const content = readVersionHistory(JSON.parse(text));
    if (!content || !channel) throw new Error("Version history is invalid");
    releases = content
      .filter((release) => desktopVersion(release.version, channel))
      .toSorted((a, b) => compareDesktopVersions(b.version, a.version));
    currentListed = releases.some((release) => release.version === version);
    kept = text;
  };
  const refresh = async (channel: DesktopChannel) => {
    try {
      const previous = kept;
      const text = await readResponse(
        await fetchHistory(`${UPDATES_ORIGIN}/v1/${desktopHistoryKey(channel)}`),
        maxBytes,
      );
      accept(text);
      if (text !== previous) {
        await writeFile(`${cache}.tmp`, text);
        await rename(`${cache}.tmp`, cache);
      }
    } catch {
      if (releases !== null) return;
      try {
        const file = await open(cache);
        try {
          if ((await file.stat()).size > maxBytes) return;
          const chunks: Buffer[] = [];
          for await (const chunk of file.createReadStream({ end: maxBytes, autoClose: false }))
            chunks.push(chunk as Buffer);
          const bytes = Buffer.concat(chunks);
          if (bytes.length <= maxBytes) accept(bytes.toString("utf8"));
        } finally {
          await file.close();
        }
      } catch {
        // First launch offline, or no readable cache.
      }
    }
  };
  return async (offset: number, reload: boolean): Promise<DesktopVersionHistory> => {
    if (!channel)
      return { version, channel, currentListed, releases: { items: [], offset, total: 0 } };
    if (reload || releases === null)
      loading ??= refresh(channel).finally(() => {
        loading = undefined;
      });
    await loading;
    return {
      version,
      channel,
      currentListed,
      releases: releases && {
        items: releases.slice(offset, offset + VERSION_HISTORY_PAGE_SIZE),
        offset,
        total: releases.length,
      },
    };
  };
};
