import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { USAGE_WARNINGS } from "./limits.ts";
import { freshDatabase } from "./testing.ts";
import { type UsageSecrets, watchUsage } from "./usage.ts";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const ANALYTICS_TOKEN = "cf-analytics-token-for-tests";
const TURSO_ORG = "wave-org-for-tests";
const TURSO_TOKEN = "turso-platform-token-for-tests";

const SECRETS: UsageSecrets = {
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  CLOUDFLARE_ANALYTICS_TOKEN: ANALYTICS_TOKEN,
  TURSO_ORG,
  TURSO_PLATFORM_TOKEN: TURSO_TOKEN,
};

interface TursoUsage {
  readonly rows_read: number;
  readonly rows_written: number;
  readonly storage_bytes: number;
}

/** What the fake upstreams answer; a number answers that HTTP status with no data. */
interface Upstreams {
  requests?: Readonly<Record<string, number>> | number;
  turso?: TursoUsage | number;
}

/** Cloudflare's GraphQL API and Turso's Platform API, answering from [upstreams]. */
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
    if (request.url === `https://api.turso.tech/v1/organizations/${TURSO_ORG}/usage`) {
      const { turso = { rows_read: 0, rows_written: 0, storage_bytes: 0 } } = upstreams;
      if (typeof turso === "number") return new Response("{}", { status: turso });
      return Response.json({ organization: { uuid: "org-uuid", usage: turso, databases: [] } });
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

describe("the usage watch: Turso", () => {
  const under = { rows_read: 1, rows_written: 1, storage_bytes: 1 };

  test("past each Turso threshold it writes a warning naming it", async () => {
    const { warnings, calls } = await watch({
      upstreams: {
        turso: {
          rows_read: USAGE_WARNINGS.tursoRowsReadPerMonth,
          rows_written: USAGE_WARNINGS.tursoRowsWrittenPerMonth + 1,
          storage_bytes: USAGE_WARNINGS.tursoStorageBytes + 1,
        },
      },
    });
    assert.equal(warnings.length, 3);
    for (const [i, name] of [
      "tursoRowsReadPerMonth",
      "tursoRowsWrittenPerMonth",
      "tursoStorageBytes",
    ].entries()) {
      assert.match(warnings[i]!, new RegExp(`^wave usage warning: ${name} `));
    }
    const turso = calls.find((call) => call.url.includes("turso"))!;
    assert.equal(turso.authorization, `Bearer ${TURSO_TOKEN}`);
  });

  test("under every Turso threshold it writes no warning", async () => {
    const { warnings } = await watch({ upstreams: { turso: under } });
    assert.deepEqual(warnings, []);
  });

  test("a Turso threshold passed warns once a UTC month", async () => {
    const upstreams = { turso: { ...under, rows_written: 6_000_000 } };
    const first = await watch({ upstreams, now: Date.UTC(2026, 10, 6) });
    const { db } = first;
    const later = await watch({ upstreams, db, now: Date.UTC(2026, 10, 29) });
    const nextMonth = await watch({ upstreams, db, now: Date.UTC(2026, 11, 1) });
    assert.equal(first.warnings.length, 1);
    assert.deepEqual(later.warnings, []);
    assert.equal(nextMonth.warnings.length, 1);
  });
});

describe("the usage watch: missing secrets and failing sources", () => {
  test("a source whose secrets aren't set is skipped with a note, and the other still runs", async () => {
    const { warnings, notes, calls } = await watch({
      secrets: { TURSO_ORG, TURSO_PLATFORM_TOKEN: TURSO_TOKEN },
      upstreams: { turso: { rows_read: 0, rows_written: 9_000_000, storage_bytes: 0 } },
    });
    assert.ok(calls.every((call) => !call.url.includes("cloudflare")));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /tursoRowsWrittenPerMonth/);
    assert.equal(notes.length, 1);
    assert.match(notes[0]!, /CLOUDFLARE_ANALYTICS_TOKEN/);
  });

  test("with no secrets it calls nothing and warns nothing", async () => {
    const { warnings, notes, calls } = await watch({ secrets: {}, upstreams: {} });
    assert.deepEqual(calls, []);
    assert.deepEqual(warnings, []);
    assert.equal(notes.length, 2);
  });

  test("a source that answers an error warns that it can't be read, once a day", async () => {
    const upstreams = { requests: 403, turso: 401 };
    const first = await watch({ upstreams, now: Date.UTC(2026, 10, 6, 1) });
    const later = await watch({ upstreams, db: first.db, now: Date.UTC(2026, 10, 6, 2) });
    assert.equal(first.warnings.length, 2);
    assert.match(first.warnings[0]!, /^wave usage warning: .*Cloudflare.*403/);
    assert.match(first.warnings[1]!, /^wave usage warning: .*Turso.*401/);
    assert.deepEqual(later.warnings, []);
  });

  test("a source that can't be reached, or answers no figures, warns too", async () => {
    const db = await freshDatabase();
    const warnings: string[] = [];
    await watchUsage({
      db,
      secrets: SECRETS,
      fetch: async (input) => {
        if (String(input).includes("cloudflare")) throw new TypeError("network down");
        return Response.json({ organization: {} });
      },
      warn: (message) => warnings.push(message),
      note: () => {},
    });
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /Cloudflare/);
    assert.match(warnings[1]!, /Turso/);
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

  test("no line carries a token, the account or the organization", async () => {
    const lines: string[] = [];
    for (const upstreams of [
      {
        requests: { "wave-sync": 90_000 },
        turso: { rows_read: 3e8, rows_written: 6e6, storage_bytes: 3e9 },
      },
      { requests: 401, turso: 403 },
    ]) {
      const { warnings, notes } = await watch({ upstreams });
      lines.push(...warnings, ...notes);
    }
    const { notes } = await watch({ secrets: {}, upstreams: {} });
    lines.push(...notes);
    assert.ok(lines.length >= 7);
    for (const line of lines) {
      for (const secret of [ACCOUNT_ID, ANALYTICS_TOKEN, TURSO_ORG, TURSO_TOKEN]) {
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
  for (const app of ["sync", "updates"]) {
    test(`keeps Workers Logs and Issues on for ${app}`, () => {
      const wrangler = read(app);
      assert.match(wrangler, /\[observability\]\nenabled = true\nhead_sampling_rate = 1\n/);
      assert.match(wrangler, /\[observability\.issues\]\nenabled = true\n/);
    });
  }
});
