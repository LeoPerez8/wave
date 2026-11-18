import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { USAGE_WARNINGS } from "./limits.ts";
import { favorite, freshDatabase, harness, pullAll, push } from "./testing.ts";
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

/** How many warning entries [db] keeps, and the UTC days of the oldest and newest. */
const keptWarnings = async (db: Awaited<ReturnType<typeof freshDatabase>>) => {
  const { rows } = await db.execute(
    "SELECT count(*) AS count, min(period) AS oldest, max(period) AS newest FROM usage_warnings",
  );
  const row = rows[0]!;
  return { count: Number(row["count"]), oldest: row["oldest"], newest: row["newest"] };
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

  test("it keeps the warnings of today and the 29 UTC days before, at most 60", async () => {
    const db = await freshDatabase();
    // Both categories warn on each of 31 days, the last at the day's final millisecond.
    for (let day = 1; day <= 31; day++) {
      for (const requests of [403, { "wave-sync": 80_000 }]) {
        await watch({ db, upstreams: { requests }, now: Date.UTC(2026, 9, day, 23, 59, 59, 999) });
      }
    }
    assert.deepEqual(await keptWarnings(db), {
      count: 60,
      oldest: "2026-10-02",
      newest: "2026-10-31",
    });

    // Later the same day nothing warns again; the next day warns anew, and the window moves.
    const later = await watch({
      db,
      upstreams: { requests: { "wave-sync": 80_000 } },
      now: Date.UTC(2026, 9, 31, 23, 59, 59, 999),
    });
    assert.deepEqual(later.warnings, []);
    const nextDay = await watch({
      db,
      upstreams: { requests: { "wave-sync": 80_000 } },
      now: Date.UTC(2026, 10, 1),
    });
    assert.equal(nextDay.warnings.length, 1);
    assert.deepEqual(await keptWarnings(db), {
      count: 59,
      oldest: "2026-10-03",
      newest: "2026-11-01",
    });
  });

  test("it deletes old warnings without its secrets, and when Cloudflare can't be read", async () => {
    const none = { count: 0, oldest: null, newest: null };
    const todays = { count: 1, oldest: "2026-11-06", newest: "2026-11-06" };
    const runs: { secrets?: UsageSecrets; upstreams: Upstreams; kept: object }[] = [
      { secrets: {}, upstreams: {}, kept: none },
      { secrets: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID }, upstreams: {}, kept: none },
      { upstreams: { requests: 500 }, kept: todays },
      { upstreams: { requests: { "wave-sync": 80_000 } }, kept: todays },
    ];
    for (const { kept, ...run } of runs) {
      const { db } = await watch({ upstreams: { requests: 403 }, now: Date.UTC(2026, 9, 1, 12) });
      await watch({ ...run, db, now: Date.UTC(2026, 10, 6, 12) });
      assert.deepEqual(await keptWarnings(db), kept, JSON.stringify(run));
    }
  });

  test("when the database can't remember a warning, it still warns", async () => {
    const db = await freshDatabase();
    await db.execute("DROP TABLE usage_warnings");
    const { warnings } = await watch({ upstreams: { requests: { "wave-sync": 80_000 } }, db });
    assert.equal(warnings.length, 1);
  });
});

describe("the usage watch: provider allowances", () => {
  test("it never gives back today's provider allowance, which still ends with the UTC day", async () => {
    const service = await harness({
      limits: {
        maxGeniusRequestsPerDay: 1,
        maxTicketmasterAttractionSearchesPerDay: 1,
        maxTicketmasterEventLookupsPerDay: 1,
      },
    });
    service.now = Date.UTC(2026, 9, 14, 12);
    const session = await service.signIn();
    const routes = [
      ["/v1/genius/song?id=1", "/v1/genius/song?id=2"],
      [
        "/v1/ticketmaster/attractions?keyword=Coldplay",
        "/v1/ticketmaster/attractions?keyword=Muse",
      ],
      [
        "/v1/ticketmaster/events?attractionId=K8vZ917_XCf&countryCode=BR",
        "/v1/ticketmaster/events?attractionId=K8vZ917_XCf&countryCode=PT",
      ],
    ] as const;
    const statuses = async (index: 0 | 1) => {
      const answers: number[] = [];
      for (const paths of routes) {
        answers.push((await service.request("GET", paths[index], { session })).status);
      }
      return answers;
    };
    assert.deepEqual(await statuses(0), [200, 200, 200]);
    assert.deepEqual(await statuses(1), [429, 429, 429]);

    for (const secrets of [SECRETS, {}]) {
      for (const upstreams of [{ requests: { "wave-sync": 80_000 } }, { requests: 500 }]) {
        await watch({ db: service.db, secrets, upstreams, now: service.now });
      }
    }
    assert.deepEqual(await statuses(1), [429, 429, 429]);

    service.now = Date.UTC(2026, 9, 15, 0, 0, 1);
    await watch({ db: service.db, upstreams: { requests: 500 }, now: service.now });
    assert.deepEqual(await statuses(1), [200, 200, 200]);
    // One entry per account and provider category, whatever the days.
    const entries = await service.db.execute("SELECT count(*) AS n FROM upstream_usage");
    assert.equal(Number(entries.rows[0]?.n), 3);
  });
});

describe("the usage watch: what it leaves alone", () => {
  test("synced rows, tombstones, sessions and this minute's sign-in count outlast it", async () => {
    const service = await harness({ limits: { maxSignInsPerMinute: 2 } });
    service.now = Date.UTC(2026, 9, 14, 12);
    const session = await service.signIn();
    await push(service, session, {
      favorites: [favorite("song-1", 100), favorite("song-2", 100)],
      plays: [],
    });
    await push(service, session, {
      favorites: [{ id: "song-2", changedAt: 200, phoneId: "phone-a", deleted: true }],
    });
    await service.signIn();

    // Sixty days on, past the warnings' 30, the session idle but within its 90.
    service.now = Date.UTC(2026, 11, 13, 12);
    await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    for (const secrets of [SECRETS, {}]) {
      await watch({ db: service.db, secrets, upstreams: { requests: 500 }, now: service.now });
    }

    const pulled = await pullAll(service, session);
    assert.deepEqual(
      pulled.favorites.map((row) => [row.id, row["deleted"]]),
      [
        ["song-1", false],
        ["song-2", true],
      ],
    );
    const refused = await service.request("POST", "/v1/session", {
      json: {
        idToken: await service.google.idToken({ sub: "google-sub-2", email: "bo@example.com" }),
      },
    });
    assert.equal(refused.status, 429, "this minute's sign-ins still count");
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
