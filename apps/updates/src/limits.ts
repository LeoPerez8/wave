/**
 * How much the service answers each client address in a UTC day (README.md, Limits). The counts
 * live in a SQLite-backed Durable Object per address (`RequestCounts`, declared in wrangler.toml),
 * which needs nothing created before a deploy. The address is only ever held as a SHA-256.
 */

/** The routes counted, each on its own. */
export type CountedRoute = "manifest" | "notes" | "apk" | "assets";

/**
 * Answers per address, route and UTC day. Assets are content-addressed files an update download
 * fetches in a burst; a whole export is well under a hundred, so 1,000 a day is never reached
 * by phones that get 3 manifest answers between them.
 */
export const DAILY_LIMITS: Readonly<Record<CountedRoute, number>> = {
  manifest: 3,
  notes: 3,
  apk: 3,
  assets: 1000,
};

const DAY_MS = 24 * 60 * 60_000;

/** The UTC day `at` falls on, as `YYYY-MM-DD`. */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** When `day` ends: the next UTC midnight. */
export const dayEndsAt = (day: string): number => Date.parse(`${day}T00:00:00.000Z`) + DAY_MS;

/**
 * The block an address counts under: an IPv4 address on its own, an IPv6 one by its /64, the
 * block a single subscriber is given.
 */
export const addressBlock = (address: string): string => {
  const trimmed = address.trim().toLowerCase();
  // IPv4, also when written inside IPv6 (`::ffff:192.0.2.1`).
  if (trimmed.includes(".")) return trimmed.slice(trimmed.lastIndexOf(":") + 1);
  if (!trimmed.includes(":")) return trimmed;
  const groups = (text: string) => (text === "" ? [] : text.split(":"));
  const [head = "", tail] = trimmed.split("::", 2);
  const front = groups(head);
  const back = tail === undefined ? [] : groups(tail);
  const all =
    tail === undefined
      ? front
      : [
          ...front,
          ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"),
          ...back,
        ];
  const prefix = all.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
};

/** [text]'s SHA-256, in hex, as the sync service keys addresses. */
const sha256Hex = async (text: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** The key an address is counted by: its block's SHA-256. The address itself is never kept. */
export const addressKey = (address: string): Promise<string> => sha256Hex(addressBlock(address));

/** Counts one answer from `route` on `day` for the address, and says whether it was within `max`. */
export interface RequestCounter {
  count(address: string, route: CountedRoute, day: string, max: number): Promise<boolean>;
}

/** What a Durable Object's storage gives the counter. */
export interface CountStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(at: number): Promise<void>;
  deleteAll(): Promise<void>;
}

interface Tally {
  readonly day: string;
  readonly count: number;
}

/**
 * One address's counts. A refused request writes nothing. The first count of a day sets an alarm
 * for its end, which deletes them all, so an address leaves nothing behind once its day is over.
 */
export const countRequest = async (
  storage: CountStorage,
  { route, day, max }: { route: CountedRoute; day: string; max: number },
): Promise<boolean> => {
  const stored = await storage.get<Tally>(route);
  const count = stored?.day === day ? stored.count : 0;
  if (count >= max) return false;
  await storage.put(route, { day, count: count + 1 } satisfies Tally);
  if (count === 0) await storage.setAlarm(dayEndsAt(day));
  return true;
};

const ROUTES: readonly string[] = ["manifest", "notes", "apk", "assets"] satisfies CountedRoute[];

/**
 * The Durable Object holding one address's counts (wrangler.toml), named by the address's key.
 * Only the Worker reaches it. Its storage blocks other requests while one counts, so a count
 * can't be read twice before it's written.
 */
export class RequestCounts {
  readonly storage: CountStorage;

  constructor(state: { readonly storage: CountStorage }) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const { route, day, max } = (await request.json()) as Record<string, unknown>;
    if (!ROUTES.includes(String(route)) || typeof day !== "string" || typeof max !== "number") {
      return new Response("Bad count", { status: 400 });
    }
    const counted = await countRequest(this.storage, { route: route as CountedRoute, day, max });
    return Response.json({ counted });
  }

  async alarm(): Promise<void> {
    await this.storage.deleteAll();
  }
}

/** The Durable Object namespace bound in wrangler.toml, as far as the counter uses it. */
export interface CountNamespace<Id = unknown> {
  idFromName(name: string): Id;
  get(id: Id): { fetch(input: string, init: RequestInit): Promise<Response> };
}

/** Counts in the address's own `RequestCounts`. */
export const durableCounter = <Id>(namespace: CountNamespace<Id>): RequestCounter => ({
  count: async (address, route, day, max) => {
    const counts = namespace.get(namespace.idFromName(address));
    const response = await counts.fetch("https://counts.internal/", {
      method: "POST",
      body: JSON.stringify({ route, day, max }),
    });
    if (!response.ok) throw new Error(`The count answered ${response.status}`);
    const { counted } = (await response.json()) as { counted: unknown };
    return counted === true;
  },
});
