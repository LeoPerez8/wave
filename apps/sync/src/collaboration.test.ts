import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readPullPage } from "@wave/core";
import { addMember } from "./collaborations.ts";
import { migrate } from "./migrations.ts";
import {
  type Harness,
  type HarnessOptions,
  type Pulled,
  freshDatabase,
  harness,
  pull,
  pullAll,
  push,
  requestAccountDeletion,
} from "./testing.ts";

const BO = { sub: "google-sub-2", email: "bo@example.com", name: "Bo Lima" };
const CY = { sub: "google-sub-3", email: "cy@example.com", name: "Cy Reis" };

const playlist = (id: string, name = "Road trip") => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  name,
  createdAt: 1_700_000_000_000,
});

const entry = (id: string, playlistId: string) => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  playlistId,
  orderKey: "a0",
  songId: null,
  ytSong: JSON.stringify({ videoId: id }),
  addedAt: 100,
});

const make = (service: Harness, session: string | undefined, json: unknown): Promise<Response> =>
  service.request(
    "POST",
    "/v1/collaboration",
    session === undefined ? { json } : { session, json },
  );

const call = (service: Harness, method: string, path: string, session: string): Promise<Response> =>
  service.request(method, `/v1/collaboration${path}`, { session });

const end = (service: Harness, session: string, id: string) =>
  call(service, "DELETE", `?playlist=${id}`, session);

const members = (service: Harness, session: string, id: string) =>
  call(service, "GET", `/members?playlist=${id}`, session);

const remove = (service: Harness, session: string, id: string, account: string) =>
  call(service, "DELETE", `/members?playlist=${id}&account=${account}`, session);

const leave = (service: Harness, session: string, id: string) =>
  call(service, "DELETE", `/membership?playlist=${id}`, session);

/** The status and error a refusal answers. */
const refusal = async (response: Response): Promise<[number, unknown]> => [
  response.status,
  ((await response.json()) as { error?: unknown }).error,
];

/** The service's id of the account with Google subject [sub]. */
const accountId = async (service: Harness, sub: string): Promise<string> =>
  String(
    (await service.db.execute({ sql: "SELECT id FROM accounts WHERE google_sub = ?", args: [sub] }))
      .rows[0]?.id,
  );

/** What a pull says of [id]: its members' names, owner first, or null when the account isn't in it. */
const namesIn = (pulled: Pulled, id: string): (string | null)[] | null =>
  pulled.collaborations
    .find((collaboration) => collaboration.playlistId === id)
    ?.members.map((member) => member.name) ?? null;

/**
 * Ana (signed in on two phones) owns the collaborative playlist `list-1`, with
 * one entry; Bo and Cy joined it, in that order. Joining is the invite's
 * route, so the members are added straight to the record here.
 */
const shared = async (options: HarnessOptions = {}) => {
  const service = await harness(options);
  const ana = await service.signIn({ name: "Ana Souza" });
  const anaOtherPhone = await service.signIn();
  const bo = await service.signIn(BO);
  const cy = await service.signIn(CY);
  const stranger = await service.signIn({ sub: "google-sub-4", email: "di@example.com" });
  await push(service, ana, {
    playlists: [playlist("list-1")],
    playlistEntries: [entry("entry-1", "list-1")],
  });
  assert.equal((await make(service, ana, { playlistId: "list-1" })).status, 200);
  const ids = {
    ana: await accountId(service, "google-sub-1"),
    bo: await accountId(service, BO.sub),
    cy: await accountId(service, CY.sub),
  };
  service.now += 1000;
  assert.equal(await addMember(service.db, "list-1", ids.bo, service.now), true);
  service.now += 1000;
  assert.equal(await addMember(service.db, "list-1", ids.cy, service.now), true);
  service.now += 1000;
  return { service, ana, anaOtherPhone, bo, cy, stranger, ids };
};

describe("making a playlist collaborative", () => {
  test("the account that holds the playlist becomes its owner and only member", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana Souza" });
    await push(service, ana, { playlists: [playlist("list-1")] });

    const response = await make(service, ana, { playlistId: "list-1" });
    assert.equal(response.status, 200);
    const expected = {
      playlistId: "list-1",
      members: [
        {
          accountId: await accountId(service, "google-sub-1"),
          name: "Ana Souza",
          joinedAt: service.now,
          owner: true,
          self: true,
        },
      ],
    };
    assert.deepEqual(await response.json(), expected);
    const pulled = await pull(service, ana);
    assert.deepEqual(pulled.collaborations, [expected]);
    assert.deepEqual(pulled.endedCollaborations, []);
  });

  test("an account in no collaborative playlist pulls two empty lists", async () => {
    const service = await harness();
    const pulled = await pull(service, await service.signIn());
    assert.deepEqual(pulled.collaborations, []);
    assert.deepEqual(pulled.endedCollaborations, []);
  });

  test("a playlist the account doesn't hold is refused: unknown, deleted or another account's", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const bo = await service.signIn(BO);
    await push(service, ana, {
      playlists: [playlist("list-1"), { ...playlist("gone"), deleted: true }],
    });
    assert.deepEqual(await refusal(await make(service, ana, { playlistId: "nope" })), [
      404,
      "not_found",
    ]);
    assert.deepEqual(await refusal(await make(service, ana, { playlistId: "gone" })), [
      404,
      "not_found",
    ]);
    assert.deepEqual(await refusal(await make(service, bo, { playlistId: "list-1" })), [
      404,
      "not_found",
    ]);
    for (const session of [ana, bo]) {
      assert.deepEqual((await pull(service, session)).collaborations, []);
    }
  });

  test("making it again changes nothing", async () => {
    const service = await harness();
    const ana = await service.signIn();
    await push(service, ana, { playlists: [playlist("list-1")] });
    const first = await (await make(service, ana, { playlistId: "list-1" })).json();
    service.now += 60_000;
    const again = await make(service, ana, { playlistId: "list-1" });
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), first);
  });

  test("an id that names another account's collaborative playlist is refused", async () => {
    const { service, bo, ids } = await shared();
    // Bo's own playlist happens to have the id of Ana's.
    await push(service, bo, { playlists: [playlist("list-1", "Bo's")] });
    assert.deepEqual(await refusal(await make(service, bo, { playlistId: "list-1" })), [
      409,
      "taken",
    ]);
    const owner = (await pull(service, bo)).collaborations[0]?.members.find((m) => m.owner);
    assert.equal(owner?.accountId, ids.ana);
  });

  test("it needs a session and a playlist id", async () => {
    const service = await harness();
    const ana = await service.signIn();
    assert.equal((await make(service, undefined, { playlistId: "list-1" })).status, 401);
    for (const body of [{}, { playlistId: "" }, { playlistId: 7 }, "list-1", null]) {
      assert.deepEqual(await refusal(await make(service, ana, body)), [400, "bad_request"]);
    }
  });
});

describe("a member's pull", () => {
  test("carries the playlists it is in, with every member's name and no email", async () => {
    const { service, ana, anaOtherPhone, bo, cy, stranger, ids } = await shared();
    const first = await pull(service, ana);
    const joinedAt = first.collaborations[0]?.members.map((member) => member.joinedAt) ?? [];
    for (const [session, self] of [
      [ana, ids.ana],
      [anaOtherPhone, ids.ana],
      [bo, ids.bo],
      [cy, ids.cy],
    ] as const) {
      const pulled = await pull(service, session);
      assert.deepEqual(pulled.collaborations, [
        {
          playlistId: "list-1",
          members: [
            { accountId: ids.ana, name: "Ana Souza", joinedAt: joinedAt[0], owner: true },
            { accountId: ids.bo, name: "Bo Lima", joinedAt: joinedAt[1], owner: false },
            { accountId: ids.cy, name: "Cy Reis", joinedAt: joinedAt[2], owner: false },
          ].map((member) => ({ ...member, self: member.accountId === self })),
        },
      ]);
      assert.ok(!JSON.stringify(pulled.collaborations).includes("@"));
    }
    assert.ok((joinedAt[0] ?? 0) < (joinedAt[1] ?? 0) && (joinedAt[1] ?? 0) < (joinedAt[2] ?? 0));
    assert.deepEqual((await pull(service, stranger)).collaborations, []);
  });

  test("carries them on every page and whatever the cursor", async () => {
    const service = await harness({ pullPageSize: 1 });
    const ana = await service.signIn();
    await push(service, ana, { playlists: [playlist("list-1"), playlist("list-2")] });
    await make(service, ana, { playlistId: "list-1" });
    const first = await pull(service, ana);
    assert.equal(first.more, true);
    const last = await pull(service, ana, first.cursor);
    const idle = await pull(service, ana, last.cursor);
    assert.deepEqual(idle.playlists, []);
    for (const page of [first, last, idle]) assert.deepEqual(namesIn(page, "list-1"), [null]);
  });

  test("a member whose account has no name shows none", async () => {
    const service = await harness();
    const ana = await service.signIn();
    await push(service, ana, { playlists: [playlist("list-1")] });
    await make(service, ana, { playlistId: "list-1" });
    assert.deepEqual(namesIn(await pull(service, ana), "list-1"), [null]);
  });

  test("an app from before collaborative playlists reads the page as before", async () => {
    const { service, bo, ana } = await shared();
    await leave(service, bo, "list-1");
    for (const session of [ana, bo]) {
      const response = await service.request("GET", "/v1/pull", { session });
      const page = readPullPage(await response.text());
      assert.ok(page !== null);
      assert.equal(page.playlists.length, session === ana ? 1 : 0);
      assert.equal(page.playlistEntries.length, session === ana ? 1 : 0);
      assert.equal(page.more, false);
    }
  });
});

describe("the members of a collaborative playlist", () => {
  test("any member reads them", async () => {
    const { service, ana, bo } = await shared();
    for (const session of [ana, bo]) {
      const response = await members(service, session, "list-1");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), (await pull(service, session)).collaborations[0]);
    }
  });

  test("an account that isn't in it, and a playlist that isn't collaborative, answer the same", async () => {
    const { service, ana, stranger } = await shared();
    await push(service, ana, { playlists: [playlist("list-2")] });
    assert.deepEqual(await refusal(await members(service, stranger, "list-1")), [
      403,
      "not_member",
    ]);
    assert.deepEqual(await refusal(await members(service, ana, "list-2")), [403, "not_member"]);
    assert.deepEqual(await refusal(await members(service, ana, "nope")), [403, "not_member"]);
    assert.deepEqual(await refusal(await call(service, "GET", "/members", ana)), [
      400,
      "bad_request",
    ]);
  });
});

describe("ending a collaboration", () => {
  test("only the owner ends it", async () => {
    const { service, ana, bo, stranger } = await shared();
    assert.deepEqual(await refusal(await end(service, bo, "list-1")), [403, "not_owner"]);
    assert.deepEqual(await refusal(await end(service, stranger, "list-1")), [403, "not_member"]);
    assert.deepEqual(await refusal(await end(service, ana, "nope")), [403, "not_member"]);
    assert.deepEqual(namesIn(await pull(service, ana), "list-1"), [
      "Ana Souza",
      "Bo Lima",
      "Cy Reis",
    ]);
  });

  test("the record goes and the playlist's rows stay as they are", async () => {
    const { service, ana, anaOtherPhone } = await shared();
    const before = await pullAll(service, ana);
    assert.equal((await end(service, ana, "list-1")).status, 204);
    const after = await pullAll(service, anaOtherPhone);
    assert.deepEqual(after.playlists, before.playlists);
    assert.deepEqual(after.playlistEntries, before.playlistEntries);
    assert.equal(after.cursor, before.cursor);
    assert.deepEqual(after.collaborations, []);
    assert.deepEqual(after.endedCollaborations, []);
    assert.deepEqual(await refusal(await members(service, ana, "list-1")), [403, "not_member"]);
  });

  test("every other member's next pull says it ended", async () => {
    const { service, ana, bo, cy } = await shared();
    await end(service, ana, "list-1");
    for (const session of [bo, cy]) {
      const pulled = await pull(service, session);
      assert.deepEqual(pulled.collaborations, []);
      assert.deepEqual(pulled.endedCollaborations, [
        { playlistId: "list-1", reason: "ended", endedAt: service.now },
      ]);
    }
  });

  test("the owner makes it collaborative again, alone", async () => {
    const { service, ana, bo } = await shared();
    await end(service, ana, "list-1");
    assert.equal((await make(service, ana, { playlistId: "list-1" })).status, 200);
    assert.deepEqual(namesIn(await pull(service, ana), "list-1"), ["Ana Souza"]);
    assert.equal(namesIn(await pull(service, bo), "list-1"), null);
    assert.equal((await pull(service, bo)).endedCollaborations.length, 1);
  });
});

describe("removing a member", () => {
  test("only the owner removes one", async () => {
    const { service, bo, stranger, ids } = await shared();
    assert.deepEqual(await refusal(await remove(service, bo, "list-1", ids.cy)), [
      403,
      "not_owner",
    ]);
    assert.deepEqual(await refusal(await remove(service, stranger, "list-1", ids.cy)), [
      403,
      "not_member",
    ]);
    assert.deepEqual(namesIn(await pull(service, bo), "list-1"), [
      "Ana Souza",
      "Bo Lima",
      "Cy Reis",
    ]);
  });

  test("the removed member's pull says it ended; the others' no longer list them", async () => {
    const { service, ana, anaOtherPhone, bo, cy, ids } = await shared();
    assert.equal((await remove(service, ana, "list-1", ids.bo)).status, 204);
    const removed = await pull(service, bo);
    assert.deepEqual(removed.collaborations, []);
    assert.deepEqual(removed.endedCollaborations, [
      { playlistId: "list-1", reason: "ended", endedAt: service.now },
    ]);
    for (const session of [ana, anaOtherPhone, cy]) {
      const pulled = await pull(service, session);
      assert.deepEqual(namesIn(pulled, "list-1"), ["Ana Souza", "Cy Reis"]);
      assert.deepEqual(pulled.endedCollaborations, []);
    }
    assert.deepEqual(await refusal(await members(service, bo, "list-1")), [403, "not_member"]);
  });

  test("the owner can't be removed, and an account that isn't in it isn't found", async () => {
    const { service, ana, ids } = await shared();
    assert.deepEqual(await refusal(await remove(service, ana, "list-1", ids.ana)), [
      403,
      "owner_cannot_leave",
    ]);
    assert.deepEqual(await refusal(await remove(service, ana, "list-1", "nobody")), [
      404,
      "not_found",
    ]);
    assert.deepEqual(
      await refusal(await call(service, "DELETE", "/members?playlist=list-1", ana)),
      [400, "bad_request"],
    );
    assert.equal((await pull(service, ana)).collaborations[0]?.members.length, 3);
  });
});

describe("leaving", () => {
  test("the owner can't leave", async () => {
    const { service, ana, stranger } = await shared();
    assert.deepEqual(await refusal(await leave(service, ana, "list-1")), [
      403,
      "owner_cannot_leave",
    ]);
    assert.deepEqual(await refusal(await leave(service, stranger, "list-1")), [403, "not_member"]);
    assert.equal((await pull(service, ana)).collaborations[0]?.members.length, 3);
  });

  test("a member leaves: its devices' pulls say it left, and the others' no longer list it", async () => {
    const { service, ana, bo, cy } = await shared();
    const boOtherPhone = await service.signIn(BO);
    assert.equal((await leave(service, bo, "list-1")).status, 204);
    for (const session of [bo, boOtherPhone]) {
      const pulled = await pull(service, session);
      assert.deepEqual(pulled.collaborations, []);
      assert.deepEqual(pulled.endedCollaborations, [
        { playlistId: "list-1", reason: "left", endedAt: service.now },
      ]);
    }
    for (const session of [ana, cy]) {
      assert.deepEqual(namesIn(await pull(service, session), "list-1"), ["Ana Souza", "Cy Reis"]);
    }
    assert.deepEqual(await refusal(await leave(service, bo, "list-1")), [403, "not_member"]);
  });

  test("the owner's rows stay when a member leaves", async () => {
    const { service, ana, bo } = await shared();
    const before = await pullAll(service, ana);
    await leave(service, bo, "list-1");
    const after = await pullAll(service, ana);
    assert.deepEqual(after.playlistEntries, before.playlistEntries);
    assert.deepEqual(after.playlists, before.playlists);
  });

  test("joining again takes the end away and counts from the new join", async () => {
    const { service, bo, ids } = await shared();
    await leave(service, bo, "list-1");
    service.now += 5000;
    assert.equal(await addMember(service.db, "list-1", ids.bo, service.now), true);
    const pulled = await pull(service, bo);
    assert.deepEqual(pulled.endedCollaborations, []);
    assert.deepEqual(namesIn(pulled, "list-1"), ["Ana Souza", "Cy Reis", "Bo Lima"]);
  });

  test("nobody joins a playlist that isn't collaborative", async () => {
    const { service, ana, bo, ids } = await shared();
    await end(service, ana, "list-1");
    assert.equal(await addMember(service.db, "list-1", ids.bo, service.now), false);
    assert.deepEqual((await pull(service, bo)).collaborations, []);
    assert.equal((await pull(service, bo)).endedCollaborations.length, 1);
  });
});

describe("deleting an account", () => {
  test("a member's account goes from the playlists it was in", async () => {
    const { service, ana, bo, cy } = await shared();
    assert.equal((await requestAccountDeletion(service, bo, BO)).status, 204);
    for (const session of [ana, cy]) {
      assert.deepEqual(namesIn(await pull(service, session), "list-1"), ["Ana Souza", "Cy Reis"]);
    }
    // The same Google account, signed in again, starts with nothing.
    const back = await pull(service, await service.signIn(BO));
    assert.deepEqual([back.collaborations, back.endedCollaborations], [[], []]);
  });

  test("a playlist it owned passes to the member who joined first, rows and all", async () => {
    const { service, ana, bo, cy, ids } = await shared();
    await push(service, ana, {
      playlistEntries: [entry("entry-2", "list-1"), entry("entry-gone", "list-1")],
    });
    await push(service, ana, {
      playlistEntries: [
        { ...entry("entry-gone", "list-1"), changedAt: 2, deleted: true, removedAt: 2 },
      ],
    });
    const before = await pullAll(service, bo);
    assert.deepEqual(before.playlists, []);

    assert.equal((await requestAccountDeletion(service, ana)).status, 204);

    // Bo's ordinary pull, from where it stopped, carries the playlist and every entry.
    const after = await pullAll(service, bo, String(before.cursor));
    assert.deepEqual(
      after.playlists.map((row) => [row.id, row.name]),
      [["list-1", "Road trip"]],
    );
    assert.deepEqual(after.playlistEntries.map((row) => [row.id, row.deleted]).toSorted(), [
      ["entry-1", false],
      ["entry-2", false],
      ["entry-gone", true],
    ]);
    const owner = { accountId: ids.bo, name: "Bo Lima", owner: true };
    const member = { accountId: ids.cy, name: "Cy Reis", owner: false };
    for (const [session, self] of [
      [bo, ids.bo],
      [cy, ids.cy],
    ] as const) {
      const pulled = await pull(service, session);
      assert.deepEqual(
        pulled.collaborations.map((collaboration) => ({
          playlistId: collaboration.playlistId,
          members: collaboration.members.map(({ accountId, name, owner }) => ({
            accountId,
            name,
            owner,
          })),
          self: collaboration.members.find((one) => one.self)?.accountId,
        })),
        [{ playlistId: "list-1", members: [owner, member], self }],
      );
      assert.deepEqual(pulled.endedCollaborations, []);
      assert.equal((await members(service, session, "list-1")).status, 200);
    }
    // Bo now has what only the owner has.
    assert.equal((await remove(service, bo, "list-1", ids.cy)).status, 204);
  });

  test("the playlist passes over a member who left or was removed", async () => {
    const { service, ana, bo, cy, ids } = await shared();
    assert.equal((await leave(service, bo, "list-1")).status, 204);
    assert.equal((await requestAccountDeletion(service, ana)).status, 204);
    assert.deepEqual(namesIn(await pull(service, cy), "list-1"), ["Cy Reis"]);
    assert.deepEqual(
      (await pull(service, cy)).playlists.map((row) => row.id),
      ["list-1"],
    );
    const bosPull = await pull(service, bo);
    assert.deepEqual([bosPull.collaborations, bosPull.playlists], [[], []]);
    assert.equal(
      (await service.db.execute({ sql: "SELECT owner_id FROM collaborations", args: [] })).rows[0]
        ?.owner_id,
      ids.cy,
    );
  });

  test("the moved rows count in the new owner's caps", async () => {
    const { service, ana, bo } = await shared({ limits: { maxPlaylistEntries: 2 } });
    await push(service, bo, {
      playlists: [playlist("bos-own")],
      playlistEntries: [entry("bos-entry", "bos-own")],
    });
    await push(service, ana, { playlistEntries: [entry("entry-2", "list-1")] });

    // The move happens even when it takes Bo past the cap.
    assert.equal((await requestAccountDeletion(service, ana)).status, 204);
    assert.equal((await pullAll(service, bo)).playlistEntries.length, 3);
    const response = await service.request("POST", "/v1/push", {
      session: bo,
      json: { playlistEntries: [entry("bos-next", "bos-own")] },
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "limit", limit: "maxPlaylistEntries" });
  });

  test("nothing of the deleted owner remains in the playlist it passed on", async () => {
    const { service, ana, bo, ids } = await shared();
    assert.equal((await requestAccountDeletion(service, ana)).status, 204);
    for (const table of ["playlists", "playlist_entries", "collaboration_members"]) {
      const held = await service.db.execute({
        sql: `SELECT count(*) AS n FROM ${table} WHERE account_id = ?`,
        args: [ids.ana],
      });
      assert.equal(Number(held.rows[0]?.n), 0, table);
    }
    const owners = await service.db.execute({
      sql: "SELECT count(*) AS n FROM collaborations WHERE owner_id = ?",
      args: [ids.ana],
    });
    assert.equal(Number(owners.rows[0]?.n), 0);
    assert.deepEqual(namesIn(await pull(service, bo), "list-1"), ["Bo Lima", "Cy Reis"]);
  });

  test("a playlist with no other member is gone", async () => {
    const { service, ana, bo, cy } = await shared();
    await push(service, ana, {
      playlists: [playlist("solo")],
      playlistEntries: [entry("solo-1", "solo")],
    });
    assert.equal((await make(service, ana, { playlistId: "solo" })).status, 200);
    for (const session of [bo, cy])
      assert.equal((await leave(service, session, "list-1")).status, 204);

    assert.equal((await requestAccountDeletion(service, ana)).status, 204);
    for (const table of [
      "collaborations",
      "collaboration_members",
      "playlists",
      "playlist_entries",
    ]) {
      const left = await service.db.execute(`SELECT count(*) AS n FROM ${table}`);
      assert.equal(Number(left.rows[0]?.n), 0, table);
    }
    for (const session of [bo, cy]) {
      const pulled = await pull(service, session);
      assert.deepEqual([pulled.collaborations, pulled.playlists], [[], []]);
    }
  });
});

describe("the migration", () => {
  test("adds tables and leaves the ones there were, and their rows, as they are", async () => {
    const db = await freshDatabase({ until: "0016_account_name" });
    const before = await harness({}, db);
    const ana = await before.signIn({ name: "Ana Souza" });
    // Rows as that database held them: today's push needs the later migrations.
    const id = await accountId(before, "google-sub-1");
    await db.batch(
      [
        {
          sql: `INSERT INTO playlists (account_id, id, change_no, changed_at, phone_id, deleted,
                                       name, created_at)
                VALUES (?, 'list-1', 1, 1, 'phone-a', 0, 'Road trip', 1)`,
          args: [id],
        },
        {
          sql: `INSERT INTO playlist_entries (account_id, id, change_no, changed_at, phone_id,
                                              deleted, playlist_id, order_key, yt_song, added_at)
                VALUES (?, 'entry-1', 2, 1, 'phone-a', 0, 'list-1', 'a0', '{"videoId":"e"}', 100)`,
          args: [id],
        },
        { sql: "UPDATE accounts SET change_seq = 2 WHERE id = ?", args: [id] },
      ],
      "write",
    );
    const schema = async () =>
      (await db.execute("SELECT name, sql FROM sqlite_master ORDER BY name")).rows.map((row) => [
        row.name,
        row.sql,
      ]);
    const tables = await schema();
    const rows = async () =>
      Promise.all(
        ["accounts", "sessions", "playlists", "playlist_entries"].map(
          async (table) => (await db.execute(`SELECT * FROM ${table}`)).rows,
        ),
      );
    const held = await rows();

    assert.deepEqual(await migrate(db, { until: "0017_collaborations" }), ["0017_collaborations"]);

    const added = (await schema()).filter(([name]) => !tables.some(([known]) => known === name));
    assert.deepEqual(
      (await schema()).filter(([name]) => !added.some(([a]) => a === name)),
      tables,
    );
    assert.deepEqual(
      added.map(([name]) => name).filter((name) => !String(name).startsWith("sqlite_")),
      [
        "collaboration_ends",
        "collaboration_members",
        "collaboration_members_account_idx",
        "collaborations",
        "collaborations_owner_idx",
      ],
    );
    assert.deepEqual(await rows(), held);

    // The session made before it still syncs, and can make its playlist collaborative.
    await migrate(db);
    const pulled = await pull(before, ana);
    assert.equal(pulled.playlistEntries.length, 1);
    assert.equal((await make(before, ana, { playlistId: "list-1" })).status, 200);
  });
});
