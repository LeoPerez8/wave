import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { USAGE_WARNINGS } from "./limits.ts";
import { freshDatabase } from "./testing.ts";
import { type UsageSecrets, watchUsage } from "./usage.ts";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const ANALYTICS_TOKEN = "cf-analytics-token-for-tests";

const SECRETS: UsageSecrets = {
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  CLOUDFLARE_ANALYTICS_TOKEN: ANALYTICS_TOKEN,
};

/** What the fake upstreams answer; a number answers that HTTP status with no data. */
interface Upstreams {
  requests?: Readonly<Record<string, number>> | number;
}

/** Cloudflare's GraphQL API, answering from [upstreams]. */
const fakeUpstreams = (upstreams: Upstreams) => {
  const calls: { url: string; authorization: string | null; body: string }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const body = await request.text();
    calls.push({ url: request.url, authorization: request.headers.get("authorization"), body });
    if (request.url === "https://api.cloudflare.com/client/v4/graphql") {
      const { requests = {} } = upstreams;
      if (typeof requests === "number") return new Response("{}", { status: requests });
      const { variables } = JSON.parse(body) as { variables: Record<string, unknown> };
      assert.equal(variables["accountTag"], ACCOUNT_ID);
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: Object.entries(requests).map(([scriptName, n]) => ({
                  sum: { requests: n },
                  dimensions: { scriptName },
                })),
              },
            ],
          },
        },
        errors: null,
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
};

const watch = async (options: {
  upstreams: Upstreams;
  secrets?: UsageSecrets;
  now?: number;
  db?: Awaited<ReturnType<typeof freshDatabase>>;
}) => {
  const db = options.db ?? (await freshDatabase());
  const upstream = fakeUpstreams(options.upstreams);
  const warnings: string[] = [];
  const notes: string[] = [];
  await watchUsage({
    db,
    secrets: options.secrets ?? SECRETS,
    fetch: upstream.fetch,
    now: () => options.now ?? Date.UTC(2026, 10, 6, 15, 0),
    warn: (message) => warnings.push(message),
    note: (message) => notes.push(message),
  });
  return { db, warnings, notes, calls: upstream.calls };
};

describe("the usage watch: Worker requests", () => {
  test("past workerRequestsPerDay, summed over every Worker, it writes one warning line", async () => {
    const { warnings, calls } = await watch({
      upstreams: { requests: { "wave-sync": 69_000, "wave-updates": 1_500 } },
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /^wave usage warning: /);
    assert.match(warnings[0]!, /workerRequestsPerDay/);
    assert.match(warnings[0]!, /70500/);
    const graphql = calls.find((call) => call.url.includes("graphql"))!;
    assert.equal(graphql.authorization, `Bearer ${ANALYTICS_TOKEN}`);
    const { variables } = JSON.parse(graphql.body) as { variables: Record<string, string> };
    assert.equal(variables["since"], "2026-11-06T00:00:00Z");
  });

  test("under the threshold it writes no warning", async () => {
    const { warnings } = await watch({
      upstreams: { requests: { "wave-sync": USAGE_WARNINGS.workerRequestsPerDay - 1 } },
    });
    assert.deepEqual(warnings, []);
  });
});

describe("the usage watch: once a period", () => {
  test("a threshold passed warns once a UTC day, and again the next day", async () => {
    const upstreams = { requests: { "wave-sync": 80_000 } };
    const first = await watch({ upstreams, now: Date.UTC(2026, 10, 6, 15) });
    const { db } = first;
    const later = await watch({ upstreams, db, now: Date.UTC(2026, 10, 6, 16) });
    const nextDay = await watch({ upstreams, db, now: Date.UTC(2026, 10, 7, 23) });
    assert.equal(first.warnings.length, 1);
    assert.deepEqual(later.warnings, []);
    assert.equal(nextDay.warnings.length, 1);
    assert.match(nextDay.warnings[0]!, /2026-11-07/);
  });

  test("when the database can't remember a warning, it still warns", async () => {
    const db = await freshDatabase();
    await db.execute("DROP TABLE usage_warnings");
    const { warnings } = await watch({ upstreams: { requests: { "wave-sync": 80_000 } }, db });
    assert.equal(warnings.length, 1);
  });
});

describe("the usage watch: missing secrets and failing sources", () => {
  test("without its secrets it calls nothing and warns nothing, with a note", async () => {
    for (const secrets of [{}, { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID }]) {
      const { warnings, notes, calls } = await watch({ secrets, upstreams: {} });
      assert.deepEqual(calls, []);
      assert.deepEqual(warnings, []);
      assert.equal(notes.length, 1);
      assert.match(notes[0]!, /CLOUDFLARE_ANALYTICS_TOKEN/);
    }
  });

  test("it asks Cloudflare's analytics alone, never Turso, whatever secrets the Worker holds", async () => {
    const { calls } = await watch({
      secrets: { ...SECRETS, TURSO_ORG: "org", TURSO_PLATFORM_TOKEN: "token" } as UsageSecrets,
      upstreams: {},
    });
    assert.deepEqual(
      calls.map((call) => call.url),
      ["https://api.cloudflare.com/client/v4/graphql"],
    );
  });

  test("an error answer warns that it can't be read, once a day", async () => {
    const upstreams = { requests: 403 };
    const first = await watch({ upstreams, now: Date.UTC(2026, 10, 6, 1) });
    const later = await watch({ upstreams, db: first.db, now: Date.UTC(2026, 10, 6, 2) });
    assert.equal(first.warnings.length, 1);
    assert.match(first.warnings[0]!, /^wave usage warning: .*Cloudflare.*403/);
    assert.deepEqual(later.warnings, []);
  });

  test("an answer that can't be reached, or holds no figures, warns too", async () => {
    for (const fetch of [
      async () => {
        throw new TypeError("network down");
      },
      async () => Response.json({ data: { viewer: { accounts: [] } } }),
    ]) {
      const db = await freshDatabase();
      const warnings: string[] = [];
      await watchUsage({
        db,
        secrets: SECRETS,
        fetch,
        warn: (message) => warnings.push(message),
        note: () => {},
      });
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /Cloudflare/);
    }
  });

  test("a GraphQL error answer warns that Cloudflare can't be read", async () => {
    const db = await freshDatabase();
    const warnings: string[] = [];
    await watchUsage({
      db,
      secrets: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_ANALYTICS_TOKEN: ANALYTICS_TOKEN },
      fetch: async () => Response.json({ data: null, errors: [{ message: "not authorized" }] }),
      warn: (message) => warnings.push(message),
      note: () => {},
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Cloudflare/);
  });

  test("no line carries a token or the account", async () => {
    const lines: string[] = [];
    for (const upstreams of [{ requests: { "wave-sync": 90_000 } }, { requests: 401 }]) {
      const { warnings, notes } = await watch({ upstreams });
      lines.push(...warnings, ...notes);
    }
    const { notes } = await watch({ secrets: {}, upstreams: {} });
    lines.push(...notes);
    assert.equal(lines.length, 3);
    for (const line of lines) {
      for (const secret of [ACCOUNT_ID, ANALYTICS_TOKEN]) {
        assert.ok(!line.includes(secret), line);
      }
    }
  });
});

describe("the Workers' wrangler.toml", () => {
  const read = (app: string) =>
    readFileSync(new URL(`../../${app}/wrangler.toml`, import.meta.url), "utf8");

  test("runs the usage watch hourly", () => {
    assert.match(read("sync"), /\[triggers\]\ncrons = \["0 \* \* \* \*"\]/);
  });

  // A deploy without these keys turns Workers Logs and Issues off, and the warnings with them.
  test("keeps Workers Logs and Issues on for sync, with no invocation logs", () => {
    const wrangler = read("sync");
    assert.match(wrangler, /\[observability\]\nenabled = true\nhead_sampling_rate = 1\n/);
    assert.match(wrangler, /\[observability\.issues\]\nenabled = true\n/);
    // Its own console lines only: an invocation log would name each request's route and query.
    assert.match(wrangler, /\[observability\.logs\]\nenabled = true\ninvocation_logs = false\n/);
  });

  test("keeps no logs for updates", () => {
    assert.doesNotMatch(read("updates"), /observability/);
  });
});
