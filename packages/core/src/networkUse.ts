/**
 * What a run that asks the network costs (docs/spec.md, App log): Home's mix
 * builds and the Magic Queue's radio reads write one line each with how long
 * they took and, per host, the requests they made and the bytes they received.
 */

/** The hosts a mix build or a Magic Queue batch asks. */
export type NetworkHost = "ytMusic" | "deezer";

/** What one host was asked: requests sent, and bytes received for them. */
export interface HostNetworkUse {
  readonly requests: number;
  readonly bytes: number;
}

/** What a run asked of each host. */
export type NetworkUse = Readonly<Record<NetworkHost, HostNetworkUse>>;

/** A run that hasn't asked anything yet. */
export const NO_NETWORK_USE: NetworkUse = {
  ytMusic: { requests: 0, bytes: 0 },
  deezer: { requests: 0, bytes: 0 },
};

/** [use] with [more] asked of [host]. */
export const withNetworkUse = (
  use: NetworkUse,
  host: NetworkHost,
  more: HostNetworkUse,
): NetworkUse => ({
  ...use,
  [host]: { requests: use[host].requests + more.requests, bytes: use[host].bytes + more.bytes },
});

/** Every host's bytes in [use]: what a run received. */
export const networkUseBytes = (use: NetworkUse): number =>
  Object.values(use).reduce((total, host) => total + host.bytes, 0);

/** [text]'s size in UTF-8. */
const utf8Bytes = (text: string): number => {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

/**
 * The bytes an HTTP answer read in JS took: its Content-Length, else (an
 * answer Android unzipped drops it) its body's UTF-8 size.
 */
export const answerBytes = (contentLength: string | null, body: string): number => {
  const length = contentLength === null ? Number.NaN : Number(contentLength);
  return Number.isInteger(length) && length >= 0 ? length : utf8Bytes(body);
};

/** The hosts as the line names them, in its order. */
const HOSTS: readonly (readonly [NetworkHost, string])[] = [
  ["ytMusic", "YouTube Music"],
  ["deezer", "Deezer"],
];

const KB = 1024;
const MB = 1024 * KB;

/** Bytes in units of 1,024: "812 B", "612.4 KB", "4.27 MB". */
const formatBytes = (bytes: number): string => {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(2)} MB`;
};

const hostUse = (name: string, { requests, bytes }: HostNetworkUse): string =>
  requests === 0
    ? `${name} none`
    : `${name} ${requests} ${requests === 1 ? "request" : "requests"}, ${formatBytes(bytes)}`;

/** A run that asked the network, as its line tells it. */
export interface NetworkUseRun {
  /** What ran: "Artist mixes build", "Magic Queue radio". */
  readonly what: string;
  /** How it ended, when that says something: "4 mixes", "failed". */
  readonly outcome?: string;
  readonly durationMs: number;
  readonly use: NetworkUse;
}

/**
 * The app log's line for [run]: "Artist mixes build (4 mixes) took 34.2 s:
 * YouTube Music 18 requests, 612.4 KB; Deezer 41 requests, 270.1 KB", a
 * host asked nothing saying "none".
 */
export const networkUseLine = ({ what, outcome, durationMs, use }: NetworkUseRun): string => {
  const ran = outcome === undefined ? what : `${what} (${outcome})`;
  const hosts = HOSTS.map(([host, name]) => hostUse(name, use[host])).join("; ");
  return `${ran} took ${(Math.round(durationMs / 100) / 10).toFixed(1)} s: ${hosts}`;
};
