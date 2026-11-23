import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { catalogueOf, sha256Hex } from "@wave/core";
import { addMember } from "./collaborations.ts";
import { migrate } from "./migrations.ts";
import {
  type Harness,
  freshDatabase,
  harness,
  sessionInOlderDatabase,
  pull,
  push,
  requestAccountDeletion,
} from "./testing.ts";

const BO = { sub: "google-sub-2", email: "bo@example.com", name: "Bo Lima" };
const CY = { sub: "google-sub-3", email: "cy@example.com", name: "Cy Reis" };
const DI = { sub: "google-sub-4", email: "di@example.com", name: "Di Melo" };

const DAY_MS = 86_400_000;

const playlist = (id: string, name = "Road trip") => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  name,
  createdAt: 1_700_000_000_000,
});

/** The status and error a refusal answers. */
const refusal = async (response: Response): Promise<[number, unknown]> => [
  response.status,
  ((await response.json()) as { error?: unknown }).error,
];

const accountId = async (service: Harness, sub: string): Promise<string> =>
  String(
    (await service.db.execute({ sql: "SELECT id FROM accounts WHERE google_sub = ?", args: [sub] }))
      .rows[0]?.id,
  );

interface Created {
  readonly url: string;
  readonly expiresAt: number;
}

const createResponse = (service: Harness, session: string, playlistId: string) =>
  service.request("POST", "/v1/collaboration/invite", { session, json: { playlistId } });

/** Creates [playlistId]'s invite as its owner and gives the link's token. */
const createInvite = async (service: Harness, session: string, playlistId = "list-1") => {
  const response = await createResponse(service, session, playlistId);
  assert.equal(response.status, 200);
  const created = (await response.json()) as Created;
  const token = created.url.split("#")[1] ?? "";
  return { ...created, token };
};

const current = (service: Harness, session: string, playlistId = "list-1") =>
  service.request("GET", `/v1/collaboration/invite?playlist=${playlistId}`, { session });

const turnOff = (service: Harness, session: string, playlistId = "list-1") =>
  service.request("DELETE", `/v1/collaboration/invite?playlist=${playlistId}`, { session });

const lookUp = (service: Harness, session: string, token: unknown, address?: string) =>
  service.request("POST", "/v1/invite", {
    session,
    json: { token },
    ...(address === undefined ? {} : { headers: { "cf-connecting-ip": address } }),
  });

const join = (service: Harness, session: string, token: unknown) =>
  service.request("POST", "/v1/invite/join", { session, json: { token } });

/** The names of [playlistId]'s members in [session]'s pull, owner first; null when it isn't in it. */
const membersIn = async (service: Harness, session: string, playlistId = "list-1") =>
  (await pull(service, session)).collaborations
    .find((collaboration) => collaboration.playlistId === playlistId)
    ?.members.map((member) => member.name) ?? null;

/** Ana owns the collaborative playlist `list-1`, "Road trip"; Bo is already in it, Cy and Di aren't. */
const shared = async () => {
  const service = await harness();
  const ana = await service.signIn({ name: "Ana Souza" });
  const bo = await service.signIn(BO);
  const cy = await service.signIn(CY);
  const di = await service.signIn(DI);
  await push(service, ana, { playlists: [playlist("list-1")] });
  const made = await service.request("POST", "/v1/collaboration", {
    session: ana,
    json: { playlistId: "list-1" },
  });
  assert.equal(made.status, 200);
  service.now += 1000;
  assert.equal(
    await addMember(service.db, "list-1", await accountId(service, BO.sub), service.now),
    true,
  );
  service.now += 1000;
  return { service, ana, bo, cy, di };
};

describe("creating an invite link", () => {
  test("the owner gets an https link on the service, valid for 7 days", async () => {
    const { service, ana } = await shared();
    const { url, expiresAt, token } = await createInvite(service, ana);
    assert.match(url, /^https:\/\/sync\.wave\.test\/invite#[A-Za-z0-9_-]{43}$/);
    assert.equal(expiresAt, service.now + 7 * DAY_MS);
    assert.notEqual(token, "");
  });

  test("the service keeps only a hash of the token, with its expiry and state", async () => {
    const { service, ana } = await shared();
    const { token, expiresAt } = await createInvite(service, ana);
    const rows = await service.db.execute("SELECT * FROM collaboration_invites");
    assert.equal(rows.rows.length, 1);
    const row = rows.rows[0]!;
    assert.equal(row.token_hash, await sha256Hex(token));
    assert.equal(Number(row.expires_at), expiresAt);
    assert.equal(row.state, "active");
    for (const value of Object.values(row)) assert.ok(!String(value).includes(token));
  });

  test("each link is new", async () => {
    const { service, ana } = await shared();
    const first = await createInvite(service, ana);
    const second = await createInvite(service, ana);
    assert.notEqual(first.token, second.token);
  });

  test("only the owner invites", async () => {
    const { service, bo, cy } = await shared();
    assert.deepEqual(await refusal(await createResponse(service, bo, "list-1")), [
      403,
      "not_owner",
    ]);
    assert.deepEqual(await refusal(await createResponse(service, cy, "list-1")), [
      403,
      "not_member",
    ]);
    assert.deepEqual(await refusal(await current(service, bo)), [403, "not_owner"]);
    assert.deepEqual(await refusal(await turnOff(service, bo)), [403, "not_owner"]);
  });

  test("a playlist that isn't collaborative has no invite", async () => {
    const { service, ana } = await shared();
    await push(service, ana, { playlists: [playlist("list-2")] });
    assert.deepEqual(await refusal(await createResponse(service, ana, "list-2")), [
      403,
      "not_member",
    ]);
  });

  test("it needs a session and a playlist id", async () => {
    const { service, ana } = await shared();
    const anonymous = await service.request("POST", "/v1/collaboration/invite", {
      json: { playlistId: "list-1" },
    });
    assert.equal(anonymous.status, 401);
    for (const json of [{}, { playlistId: "" }, { playlistId: 3 }, null]) {
      const response = await service.request("POST", "/v1/collaboration/invite", {
        session: ana,
        json,
      });
      assert.deepEqual(await refusal(response), [400, "bad_request"]);
    }
  });
});

describe("the current invite link", () => {
  test("the owner reads when it was made and its last day, until it's turned off", async () => {
    const { service, ana } = await shared();
    assert.deepEqual(await (await current(service, ana)).json(), { invite: null });
    const createdAt = service.now;
    const { expiresAt } = await createInvite(service, ana);
    service.now += 1000;
    assert.deepEqual(await (await current(service, ana)).json(), {
      invite: { createdAt, expiresAt },
    });
    assert.equal((await turnOff(service, ana)).status, 204);
    assert.deepEqual(await (await current(service, ana)).json(), { invite: null });
    // Turning off when there's none is no error.
    assert.equal((await turnOff(service, ana)).status, 204);
  });

  test("an expired link isn't current", async () => {
    const { service, ana } = await shared();
    await createInvite(service, ana);
    service.now += 7 * DAY_MS;
    assert.deepEqual(await (await current(service, ana)).json(), { invite: null });
  });
});

describe("reading an invite", () => {
  test("a signed-in app sees the playlist's name and the owner's name", async () => {
    const { service, ana, cy } = await shared();
    const { token } = await createInvite(service, ana);
    const response = await lookUp(service, cy, token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      playlistId: "list-1",
      playlistName: "Road trip",
      ownerName: "Ana Souza",
    });
    // Reading it joins nothing.
    assert.equal(await membersIn(service, cy), null);
  });

  test("it needs a session", async () => {
    const { service, ana } = await shared();
    const { token } = await createInvite(service, ana);
    const response = await service.request("POST", "/v1/invite", { json: { token } });
    assert.equal(response.status, 401);
  });

  test("the playlist's latest name shows", async () => {
    const { service, ana, cy } = await shared();
    const { token } = await createInvite(service, ana);
    await push(service, ana, { playlists: [{ ...playlist("list-1", "Beach"), changedAt: 2 }] });
    const answer = (await (await lookUp(service, cy, token)).json()) as { playlistName: string };
    assert.equal(answer.playlistName, "Beach");
  });
});

describe("joining", () => {
  test("a valid link makes the session's account a member", async () => {
    const { service, ana, bo, cy } = await shared();
    const { token } = await createInvite(service, ana);
    const response = await join(service, cy, token);
    assert.equal(response.status, 200);
    const joined = (await response.json()) as {
      playlistId: string;
      members: { name: string; self: boolean }[];
    };
    assert.equal(joined.playlistId, "list-1");
    assert.deepEqual(
      joined.members.map((member) => [member.name, member.self]),
      [
        ["Ana Souza", false],
        ["Bo Lima", false],
        ["Cy Reis", true],
      ],
    );
    for (const session of [ana, bo, cy]) {
      assert.deepEqual(await membersIn(service, session), ["Ana Souza", "Bo Lima", "Cy Reis"]);
    }
  });

  test("any number of people join with one link", async () => {
    const { service, ana, cy, di } = await shared();
    const { token } = await createInvite(service, ana);
    assert.equal((await join(service, cy, token)).status, 200);
    service.now += 1000;
    assert.equal((await join(service, di, token)).status, 200);
    assert.deepEqual(await membersIn(service, ana), ["Ana Souza", "Bo Lima", "Cy Reis", "Di Melo"]);
  });

  test("joining twice leaves one membership, from the first join", async () => {
    const { service, ana, bo, cy } = await shared();
    const { token } = await createInvite(service, ana);
    assert.equal((await join(service, cy, token)).status, 200);
    const joinedAt = service.now;
    service.now += 60_000;
    assert.equal((await join(service, cy, token)).status, 200);
    // A member already in it, and the owner, join as a no-op too.
    assert.equal((await join(service, bo, token)).status, 200);
    assert.equal((await join(service, ana, token)).status, 200);
    const members = (await pull(service, ana)).collaborations[0]?.members ?? [];
    assert.deepEqual(
      members.map((member) => member.name),
      ["Ana Souza", "Bo Lima", "Cy Reis"],
    );
    assert.equal(members.find((member) => member.name === "Cy Reis")?.joinedAt, joinedAt);
  });

  test("an expired link is refused, and the people who joined stay", async () => {
    const { service, ana, cy, di } = await shared();
    const { token } = await createInvite(service, ana);
    assert.equal((await join(service, cy, token)).status, 200);
    service.now += 7 * DAY_MS - 1;
    assert.equal((await lookUp(service, di, token)).status, 200);
    service.now += 1;
    assert.deepEqual(await refusal(await lookUp(service, di, token)), [410, "invite_ended"]);
    assert.deepEqual(await refusal(await join(service, di, token)), [410, "invite_ended"]);
    assert.deepEqual(await membersIn(service, cy), ["Ana Souza", "Bo Lima", "Cy Reis"]);
  });

  test("a turned-off link is refused, and the people who joined stay", async () => {
    const { service, ana, cy, di } = await shared();
    const { token } = await createInvite(service, ana);
    assert.equal((await join(service, cy, token)).status, 200);
    assert.equal((await turnOff(service, ana)).status, 204);
    assert.deepEqual(await refusal(await lookUp(service, di, token)), [410, "invite_ended"]);
    assert.deepEqual(await refusal(await join(service, di, token)), [410, "invite_ended"]);
    assert.deepEqual(await membersIn(service, cy), ["Ana Souza", "Bo Lima", "Cy Reis"]);
  });

  test("a new link ends the earlier one", async () => {
    const { service, ana, cy, di } = await shared();
    const earlier = await createInvite(service, ana);
    assert.equal((await join(service, cy, earlier.token)).status, 200);
    service.now += 1000;
    const later = await createInvite(service, ana);
    assert.deepEqual(await refusal(await join(service, di, earlier.token)), [410, "invite_ended"]);
    assert.equal((await join(service, di, later.token)).status, 200);
    assert.deepEqual(await membersIn(service, ana), ["Ana Souza", "Bo Lima", "Cy Reis", "Di Melo"]);
    const states = await service.db.execute(
      "SELECT state FROM collaboration_invites ORDER BY created_at, state",
    );
    assert.deepEqual(states.rows.map((row) => row.state).sort(), ["active", "replaced"]);
  });

  test("removing a member ends the current link; the removed person comes back only through a new one", async () => {
    const { service, ana, bo, cy } = await shared();
    const { token } = await createInvite(service, ana);
    const boId = await accountId(service, BO.sub);
    const removed = await service.request(
      "DELETE",
      `/v1/collaboration/members?playlist=list-1&account=${boId}`,
      { session: ana },
    );
    assert.equal(removed.status, 204);
    assert.deepEqual(await (await current(service, ana)).json(), { invite: null });
    assert.deepEqual(await refusal(await join(service, bo, token)), [410, "invite_ended"]);
    assert.deepEqual(await refusal(await join(service, cy, token)), [410, "invite_ended"]);
    assert.equal(await membersIn(service, bo), null);

    const fresh = await createInvite(service, ana);
    assert.equal((await join(service, bo, fresh.token)).status, 200);
    const pulled = await pull(service, bo);
    assert.deepEqual(pulled.endedCollaborations, []);
    assert.deepEqual(await membersIn(service, bo), ["Ana Souza", "Bo Lima"]);
  });

  test("a member leaving leaves the link as it is", async () => {
    const { service, ana, bo, cy } = await shared();
    const { token } = await createInvite(service, ana);
    assert.equal(
      (
        await service.request("DELETE", "/v1/collaboration/membership?playlist=list-1", {
          session: bo,
        })
      ).status,
      204,
    );
    assert.equal((await join(service, cy, token)).status, 200);
    // One who left joins again with it, and its end record goes.
    assert.equal((await join(service, bo, token)).status, 200);
    assert.deepEqual((await pull(service, bo)).endedCollaborations, []);
  });

  test("ending the collaboration ends its link, also once the playlist is made collaborative again", async () => {
    const { service, ana, cy } = await shared();
    const { token } = await createInvite(service, ana);
    assert.equal(
      (await service.request("DELETE", "/v1/collaboration?playlist=list-1", { session: ana }))
        .status,
      204,
    );
    assert.notEqual((await join(service, cy, token)).status, 200);
    const again = await service.request("POST", "/v1/collaboration", {
      session: ana,
      json: { playlistId: "list-1" },
    });
    assert.equal(again.status, 200);
    assert.notEqual((await lookUp(service, cy, token)).status, 200);
    assert.notEqual((await join(service, cy, token)).status, 200);
    assert.equal(await membersIn(service, cy), null);
  });

  test("a link to a playlist its owner deleted is refused", async () => {
    const { service, ana, cy } = await shared();
    const { token } = await createInvite(service, ana);
    await push(service, ana, {
      playlists: [{ ...playlist("list-1"), changedAt: 2, deleted: true }],
    });
    // Deleting the playlist ends its collaboration, which deletes its links, so the token
    // names no invite any more.
    assert.deepEqual(await refusal(await lookUp(service, cy, token)), [404, "not_found"]);
    assert.deepEqual(await refusal(await join(service, cy, token)), [404, "not_found"]);
  });

  test("a token that names no invite is refused", async () => {
    const { service, cy } = await shared();
    for (const token of ["x".repeat(43), "short", "", 7, null]) {
      const looked = await lookUp(service, cy, token);
      assert.deepEqual(await refusal(looked), [404, "not_found"]);
      const joined = await join(service, cy, token);
      assert.deepEqual(await refusal(joined), [404, "not_found"]);
    }
    assert.equal(await membersIn(service, cy), null);
  });

  test("the owner's account deletion takes its invites with it", async () => {
    const { service, ana } = await shared();
    await createInvite(service, ana);
    assert.equal((await requestAccountDeletion(service, ana)).status, 204);
    const rows = await service.db.execute("SELECT count(*) AS n FROM collaboration_invites");
    assert.equal(Number(rows.rows[0]?.n), 0);
  });
});

describe("wrong tokens", () => {
  test("count in the per-address limit of failed lookups", async () => {
    const service = await harness({
      limits: { maxFailedLookupsPerAddressPerMinute: 3, failedLookupBlockSeconds: 60 },
    });
    const ana = await service.signIn({ name: "Ana Souza" });
    const cy = await service.signIn(CY);
    await push(service, ana, { playlists: [playlist("list-1")] });
    await service.request("POST", "/v1/collaboration", {
      session: ana,
      json: { playlistId: "list-1" },
    });
    const { token } = await createInvite(service, ana);
    const address = "203.0.113.9";
    for (let i = 0; i < 4; i++) {
      assert.equal((await lookUp(service, cy, `${"w".repeat(42)}${i}`, address)).status, 404);
    }
    // Held back: even the right token, and any session, waits.
    const held = await lookUp(service, cy, token, address);
    assert.equal(held.status, 429);
    assert.deepEqual(await held.json(), {
      error: "limit",
      limit: "maxFailedLookupsPerAddressPerMinute",
    });
    assert.equal(
      (
        await service.request("GET", "/v1/pull", {
          session: cy,
          headers: { "cf-connecting-ip": address },
        })
      ).status,
      429,
    );
    // Another address isn't.
    assert.equal((await lookUp(service, cy, token, "203.0.113.10")).status, 200);
    service.now += 60_000;
    assert.equal((await lookUp(service, cy, token, address)).status, 200);
  });

  test("a valid or ended token doesn't count", async () => {
    const service = await harness({
      limits: { maxFailedLookupsPerAddressPerMinute: 2, failedLookupBlockSeconds: 60 },
    });
    const ana = await service.signIn({ name: "Ana Souza" });
    const cy = await service.signIn(CY);
    await push(service, ana, { playlists: [playlist("list-1")] });
    await service.request("POST", "/v1/collaboration", {
      session: ana,
      json: { playlistId: "list-1" },
    });
    const earlier = await createInvite(service, ana);
    const { token } = await createInvite(service, ana);
    for (let i = 0; i < 5; i++) {
      assert.equal((await lookUp(service, cy, token, "203.0.113.9")).status, 200);
      assert.equal((await lookUp(service, cy, earlier.token, "203.0.113.9")).status, 410);
    }
  });
});

describe("the invite page", () => {
  test("a browser gets a page that says only that it's a Wave invite, with no session", async () => {
    const { service, ana } = await shared();
    await createInvite(service, ana);
    const response = await service.request("GET", "/invite");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html; charset=utf-8/);
    const page = await response.text();
    const text = catalogueOf("en").invitePage;
    for (const phrase of [text.title, text.heading, text.body]) {
      assert.ok(page.includes(phrase), phrase);
    }
    for (const secret of ["Road trip", "Ana", "list-1", "<script"]) {
      assert.ok(!page.includes(secret), secret);
    }
  });

  test("it reads in the browser's language", async () => {
    const service = await harness();
    const response = await service.request("GET", "/invite", {
      headers: { "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
    });
    const page = await response.text();
    assert.ok(page.includes(catalogueOf("pt-BR").invitePage.body));
    assert.ok(page.includes('lang="pt-BR"'));
  });

  test("it isn't indexed and sends no referrer", async () => {
    const service = await harness();
    const response = await service.request("GET", "/invite");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  });
});

describe("Android's check that invite links are Wave's", () => {
  test("names Wave's package and both certificates in the signing lineage, with no session", async () => {
    const service = await harness();
    const response = await service.request("GET", "/.well-known/assetlinks.json");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    const statements = (await response.json()) as readonly {
      readonly relation: readonly string[];
      readonly target: {
        readonly namespace: string;
        readonly package_name: string;
        readonly sha256_cert_fingerprints: readonly string[];
      };
    }[];
    assert.equal(statements.length, 1);
    const [statement] = statements;
    assert.deepEqual(statement?.relation, ["delegate_permission/common.handle_all_urls"]);
    assert.equal(statement?.target.namespace, "android_app");
    assert.equal(statement?.target.package_name, "dev.leoperez.wave");
    const fingerprints = statement?.target.sha256_cert_fingerprints ?? [];
    assert.equal(fingerprints.length, 2);
    assert.ok(
      fingerprints.every((fingerprint) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)),
    );
    // The release key and the debug key its rotation proof starts from (scripts/ci/sign-apk.sh):
    // Android checks a rotated APK by the latter (#1417).
    const signing = await readFile(
      fileURLToPath(new URL("../../../scripts/ci/sign-apk.sh", import.meta.url)),
      "utf8",
    );
    const release = /release_signer="\$\{WAVE_RELEASE_SIGNER_SHA256:-([0-9a-f]{64})\}"/.exec(
      signing,
    )?.[1];
    const previous = /previous_signer="\$\{WAVE_PREVIOUS_SIGNER_SHA256:-([0-9a-f]{64})\}"/.exec(
      signing,
    )?.[1];
    assert.deepEqual(
      fingerprints.map((fingerprint) => fingerprint.replaceAll(":", "").toLowerCase()),
      [release, previous],
    );
  });
});

describe("the migration", () => {
  test("adds the invite table and leaves the others as they are", async () => {
    const db = await freshDatabase({ until: "0017_collaborations" });
    const before = await harness({}, db);
    const ana = await sessionInOlderDatabase(db, before.now, { name: "Ana Souza" });
    await push(before, ana, { playlists: [playlist("list-1")] });
    // The collaboration as that database held it: today's route needs the later migrations.
    await db.batch(
      [
        `INSERT INTO collaborations (playlist_id, owner_id, created_at)
         SELECT 'list-1', id, 1 FROM accounts`,
        `INSERT INTO collaboration_members (playlist_id, account_id, joined_at)
         SELECT 'list-1', id, 1 FROM accounts`,
      ],
      "write",
    );
    const schema = async () =>
      (await db.execute("SELECT name, sql FROM sqlite_master ORDER BY name")).rows.map((row) => [
        row.name,
        row.sql,
      ]);
    const tables = await schema();

    assert.deepEqual(await migrate(db, { until: "0018_collaboration_invites" }), [
      "0018_collaboration_invites",
    ]);

    const after = await schema();
    assert.deepEqual(
      after.filter(([name]) => tables.some(([known]) => known === name)),
      tables,
    );
    assert.deepEqual(
      after
        .map(([name]) => String(name))
        .filter((name) => !tables.some(([known]) => known === name) && !name.startsWith("sqlite_")),
      [
        "collaboration_invites",
        "collaboration_invites_active_idx",
        "collaboration_invites_owner_idx",
        "collaboration_invites_playlist_idx",
      ],
    );
    await migrate(db);
    const { token } = await createInvite(before, ana);
    assert.equal((await lookUp(before, ana, token)).status, 200);
  });
});
