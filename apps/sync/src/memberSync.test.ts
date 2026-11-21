import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client } from "@libsql/client";
import { readPullPage } from "@wave/core";
import { addMember, endCollaboration, removeMember } from "./collaborations.ts";
import {
  type HarnessOptions,
  type PulledRow,
  harness,
  pull,
  pullAll,
  push,
  requestAccountDeletion,
} from "./testing.ts";

const BO = { sub: "google-sub-2", email: "bo@example.com", name: "Bo Lima" };
const CY = { sub: "google-sub-3", email: "cy@example.com", name: "Cy Reis" };

const playlist = (id: string, overrides: Readonly<Record<string, unknown>> = {}) => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  name: "Road trip",
  createdAt: 1_700_000_000_000,
  ...overrides,
});

const ytSong = (videoId: string, overrides: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({
    videoId,
    title: `Song ${videoId}`,
    artists: ["Ana"],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    explicit: false,
    ...overrides,
  });

/** A YT Music entry of [playlistId]. */
const entry = (
  id: string,
  playlistId: string,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  playlistId,
  orderKey: "a0",
  songId: null,
  ytSong: ytSong(id),
  addedAt: 100,
  ...overrides,
});

/** A Library song's entry, with the fields a collaborative entry carries. */
const libraryEntry = (
  id: string,
  playlistId: string,
  overrides: Readonly<Record<string, unknown>> = {},
) =>
  entry(id, playlistId, {
    songId: `key-${id}`,
    ytSong: null,
    title: "Something",
    credit: "The Beatles",
    album: "Abbey Road",
    durationMs: 182_000,
    videoId: null,
    ...overrides,
  });

const song = (id: string) => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  title: "Here Comes the Sun",
  credit: "The Beatles",
  album: "Abbey Road",
  albumArtist: "The Beatles",
  discNumber: 1,
  trackNumber: 7,
  durationMs: 185_000,
  releaseDate: null,
  year: 1969,
  genre: null,
  videoId: "vid-sun",
  addedAt: 1,
});

const accountId = async (db: Client, sub: string): Promise<string> =>
  String(
    (await db.execute({ sql: "SELECT id FROM accounts WHERE google_sub = ?", args: [sub] })).rows[0]
      ?.id,
  );

/**
 * Ana owns the collaborative playlist `list-1` with one entry and also keeps
 * `own-1` of her own; Bo and Cy are members of `list-1`.
 */
const shared = async (options: HarnessOptions = {}) => {
  const service = await harness(options);
  const ana = await service.signIn({ name: "Ana Souza" });
  const bo = await service.signIn(BO);
  const cy = await service.signIn(CY);
  const stranger = await service.signIn({ sub: "google-sub-4", email: "di@example.com" });
  await push(service, ana, {
    playlists: [playlist("list-1"), playlist("own-1", { name: "Mine" })],
    playlistEntries: [entry("entry-1", "list-1"), entry("own-entry", "own-1")],
  });
  const made = await service.request("POST", "/v1/collaboration", {
    session: ana,
    json: { playlistId: "list-1" },
  });
  assert.equal(made.status, 200);
  const ids = {
    ana: await accountId(service.db, "google-sub-1"),
    bo: await accountId(service.db, BO.sub),
    cy: await accountId(service.db, CY.sub),
  };
  service.now += 1000;
  assert.equal(await addMember(service.db, "list-1", ids.bo, service.now), true);
  service.now += 1000;
  assert.equal(await addMember(service.db, "list-1", ids.cy, service.now), true);
  service.now += 1000;
  return { service, ana, bo, cy, stranger, ids };
};

type Service = Awaited<ReturnType<typeof shared>>["service"];

const memberPush = (service: Service, session: string, playlistId: string, json: unknown) =>
  service.request("POST", `/v1/collaboration/push?playlist=${encodeURIComponent(playlistId)}`, {
    session,
    json,
  });

const memberPull = (service: Service, session: string, playlistId: string, since?: string) =>
  service.request(
    "GET",
    `/v1/collaboration/pull?playlist=${encodeURIComponent(playlistId)}${
      since === undefined ? "" : `&since=${since}`
    }`,
    { session },
  );

interface PlaylistPage {
  readonly playlists: readonly PulledRow[];
  readonly playlistEntries: readonly PulledRow[];
  readonly cursor: string;
  readonly more: boolean;
}

/** Every page of [playlistId] after [since], joined. */
const pullPlaylist = async (
  service: Service,
  session: string,
  playlistId: string,
  since?: string,
): Promise<PlaylistPage & { readonly pages: number }> => {
  const playlists: PulledRow[] = [];
  const entries: PulledRow[] = [];
  let cursor = since;
  for (let pages = 1; ; pages++) {
    const response = await memberPull(service, session, playlistId, cursor);
    assert.equal(response.status, 200);
    const page = (await response.json()) as PlaylistPage;
    playlists.push(...page.playlists);
    entries.push(...page.playlistEntries);
    cursor = page.cursor;
    if (!page.more) return { playlists, playlistEntries: entries, cursor, more: false, pages };
  }
};

const refusal = async (response: Response): Promise<[number, unknown]> => [
  response.status,
  ((await response.json()) as { error?: unknown }).error,
];

const accepted = async (response: Response): Promise<Readonly<Record<string, unknown>>> => {
  const body = (await response.json()) as Readonly<Record<string, unknown>>;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
};

const byId = (rows: readonly PulledRow[], id: string): PulledRow | undefined =>
  rows.find((row) => row.id === id);

describe("a member's push of a collaborative playlist", () => {
  test("lands in the owner's account and names the member who added the entry", async () => {
    const { service, ana, bo, ids } = await shared();
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [libraryEntry("bo-1", "list-1", { changedAt: 5 })],
      }),
    );
    const owners = await pullAll(service, ana);
    const added = byId(owners.playlistEntries, "bo-1");
    assert.equal(added?.addedBy, ids.bo);
    assert.equal(added?.title, "Something");
    assert.equal(added?.credit, "The Beatles");
    assert.equal(added?.album, "Abbey Road");
    assert.equal(added?.durationMs, 182_000);
    // Bo's own account holds nothing of it.
    assert.deepEqual((await pullAll(service, bo)).playlistEntries, []);
  });

  test("the account that added an entry is the session's, whatever the app sends", async () => {
    const { service, ana, bo, ids } = await shared();
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [entry("bo-1", "list-1", { addedBy: ids.ana })],
      }),
    );
    // A later change by someone else keeps who added it.
    await push(service, ana, {
      playlistEntries: [entry("bo-1", "list-1", { changedAt: 9, orderKey: "b0", addedBy: null })],
    });
    const pulled = byId((await pullPlaylist(service, ana, "list-1")).playlistEntries, "bo-1");
    assert.equal(pulled?.addedBy, ids.bo);
    assert.equal(pulled?.orderKey, "b0");
  });

  test("renames the playlist, moves and removes entries", async () => {
    const { service, ana, bo } = await shared();
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlists: [playlist("list-1", { changedAt: 5, name: "Road trip 2" })],
        playlistEntries: [{ id: "entry-1", changedAt: 5, phoneId: "phone-b", deleted: true }],
      }),
    );
    const owners = await pullAll(service, ana);
    assert.equal(byId(owners.playlists, "list-1")?.name, "Road trip 2");
    assert.equal(byId(owners.playlistEntries, "entry-1")?.deleted, true);
  });

  test("answers what it accepted and the change times it corrected", async () => {
    const { service, bo } = await shared();
    const answer = await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [entry("bo-1", "list-1", { changedAt: service.now + 60_000 })],
      }),
    );
    assert.equal((answer.accepted as Record<string, number>).playlistEntries, 1);
    assert.deepEqual(answer.corrected, {
      playlistEntries: [{ id: "bo-1", changedAt: service.now }],
    });
  });

  test("anything but that playlist's row and entries is refused, and nothing is stored", async () => {
    const { service, ana, bo } = await shared();
    const before = (await pullAll(service, ana)).cursor;
    const bodies: unknown[] = [
      { favorites: [{ id: "k", changedAt: 1, phoneId: "p", deleted: false, addedAt: 1 }] },
      { songs: [song("key-1")] },
      { playlists: [playlist("own-1", { name: "Taken" })] },
      { playlists: [playlist("other")] },
      { playlistEntries: [entry("bo-1", "own-1")] },
      {
        playlistEntries: [entry("bo-2", "list-1")],
        preferences: [{ id: "x", changedAt: 1, phoneId: "p", deleted: false, value: null }],
      },
    ];
    for (const body of bodies) {
      assert.deepEqual(
        await refusal(await memberPush(service, bo, "list-1", body)),
        [400, "bad_request"],
        JSON.stringify(body),
      );
    }
    assert.equal((await pull(service, ana, before)).playlistEntries.length, 0);
    assert.equal((await pull(service, ana, before)).playlists.length, 0);
  });

  test("an entry the owner holds outside the playlist is dropped, and the rest is stored", async () => {
    const { service, ana, bo } = await shared();
    // A removal stored before removals kept their playlist: held in no playlist.
    await push(service, ana, {
      playlistEntries: [{ id: "old-1", changedAt: 2, phoneId: "phone-a", deleted: true }],
    });
    const before = (await pullAll(service, ana)).cursor;
    const answer = await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [
          entry("old-1", "list-1", { changedAt: 5 }),
          // An id the owner holds in another playlist.
          entry("own-entry", "list-1", { changedAt: 5 }),
          { id: "own-entry", changedAt: 9, phoneId: "p", deleted: true },
          entry("bo-1", "list-1", { changedAt: 5 }),
        ],
      }),
    );
    assert.equal((answer.accepted as Record<string, number>).playlistEntries, 1);
    const stored = (await pull(service, ana, before)).playlistEntries;
    assert.deepEqual(
      stored.map((row) => row.id),
      ["bo-1"],
    );
    const owners = await pullAll(service, ana);
    assert.equal(byId(owners.playlistEntries, "own-entry")?.playlistId, "own-1");
    assert.equal(byId(owners.playlistEntries, "own-entry")?.deleted, false);
    assert.equal(byId(owners.playlistEntries, "old-1")?.deleted, true);
  });

  test("a member's rename keeps when the playlist was made", async () => {
    const { service, ana, bo } = await shared();
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlists: [playlist("list-1", { changedAt: 5, name: "Road trip 2", createdAt: 7 })],
      }),
    );
    const held = byId((await pullAll(service, ana)).playlists, "list-1");
    assert.equal(held?.name, "Road trip 2");
    assert.equal(held?.createdAt, 1_700_000_000_000);
  });

  test("a member can't delete the playlist", async () => {
    const { service, ana, bo } = await shared();
    assert.deepEqual(
      await refusal(
        await memberPush(service, bo, "list-1", {
          playlists: [{ id: "list-1", changedAt: 5, phoneId: "p", deleted: true }],
        }),
      ),
      [403, "not_owner"],
    );
    assert.equal(byId((await pullAll(service, ana)).playlists, "list-1")?.deleted, false);
  });

  test("a removal of an entry the service never held is dropped, not stored", async () => {
    const { service, ana, bo } = await shared();
    const before = (await pullAll(service, ana)).cursor;
    const answer = await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [{ id: "never", changedAt: 5, phoneId: "p", deleted: true }],
      }),
    );
    assert.equal((answer.accepted as Record<string, number>).playlistEntries, 0);
    assert.equal((await pull(service, ana, before)).playlistEntries.length, 0);
  });

  test("an account not in the playlist is refused as not a member", async () => {
    const { service, ana, stranger, ids } = await shared();
    const body = { playlistEntries: [entry("x-1", "list-1")] };
    assert.deepEqual(await refusal(await memberPush(service, stranger, "list-1", body)), [
      403,
      "not_member",
    ]);
    // An ordinary playlist of the owner isn't collaborative.
    assert.deepEqual(
      await refusal(
        await memberPush(service, stranger, "own-1", {
          playlistEntries: [entry("x-1", "own-1")],
        }),
      ),
      [403, "not_member"],
    );
    // A removed member is refused too.
    const cy = await service.signIn(CY);
    assert.equal(await removeMember(service.db, "list-1", ids.ana, ids.cy, service.now), null);
    assert.deepEqual(await refusal(await memberPush(service, cy, "list-1", body)), [
      403,
      "not_member",
    ]);
    assert.equal(byId((await pullAll(service, ana)).playlistEntries, "x-1"), undefined);
  });

  test("a playlist no longer collaborative is refused", async () => {
    const { service, bo, ids } = await shared();
    assert.equal(await endCollaboration(service.db, "list-1", ids.ana, service.now), null);
    assert.deepEqual(
      await refusal(
        await memberPush(service, bo, "list-1", { playlistEntries: [entry("b", "list-1")] }),
      ),
      [403, "not_member"],
    );
  });

  test("a playlist the owner deleted is refused, as no longer collaborative", async () => {
    const { service, ana, bo } = await shared();
    await push(service, ana, {
      playlists: [{ id: "list-1", changedAt: 9, phoneId: "phone-a", deleted: true }],
    });
    assert.deepEqual(
      await refusal(
        await memberPush(service, bo, "list-1", { playlistEntries: [entry("b", "list-1")] }),
      ),
      [403, "not_member"],
    );
    const held = await service.db.execute({
      sql: "SELECT count(*) AS n FROM playlist_entries WHERE id = 'b'",
      args: [],
    });
    assert.equal(Number(held.rows[0]?.n), 0);
  });

  test("it needs a session, a playlist and a body of tables", async () => {
    const { service, bo } = await shared();
    const noSession = await service.request("POST", "/v1/collaboration/push?playlist=list-1", {
      json: {},
    });
    assert.equal(noSession.status, 401);
    const noPlaylist = await service.request("POST", "/v1/collaboration/push", {
      session: bo,
      json: {},
    });
    assert.deepEqual(await refusal(noPlaylist), [400, "bad_request"]);
    assert.deepEqual(await refusal(await memberPush(service, bo, "list-1", [])), [
      400,
      "bad_request",
    ]);
  });
});

describe("a member's pull of a collaborative playlist", () => {
  test("gives every change after its cursor, the owner's and other members' included", async () => {
    const { service, ana, bo, cy, ids } = await shared();
    const first = await pullPlaylist(service, cy, "list-1");
    assert.deepEqual(
      first.playlists.map((row) => row.name),
      ["Road trip"],
    );
    assert.deepEqual(
      first.playlistEntries.map((row) => [row.id, row.addedBy]),
      [["entry-1", ids.ana]],
    );

    await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [entry("bo-1", "list-1", { changedAt: 3 })],
      }),
    );
    await push(service, ana, {
      playlistEntries: [entry("ana-2", "list-1", { changedAt: 4 }), entry("own-2", "own-1")],
    });
    const next = await pullPlaylist(service, cy, "list-1", first.cursor);
    assert.deepEqual(
      next.playlistEntries.map((row) => [row.id, row.addedBy]),
      [
        ["bo-1", ids.bo],
        ["ana-2", ids.ana],
      ],
    );
    assert.deepEqual(next.playlists, []);
    // Nothing more after it.
    assert.deepEqual((await pullPlaylist(service, cy, "list-1", next.cursor)).playlistEntries, []);
  });

  test("carries a removal of an entry and never the owner's other rows", async () => {
    const { service, ana, cy } = await shared();
    const first = await pullPlaylist(service, cy, "list-1");
    await push(service, ana, {
      playlistEntries: [
        { id: "entry-1", changedAt: 9, phoneId: "phone-a", deleted: true },
        { id: "own-entry", changedAt: 9, phoneId: "phone-a", deleted: true },
      ],
      favorites: [{ id: "k", changedAt: 1, phoneId: "p", deleted: false, addedAt: 1 }],
    });
    const next = await pullPlaylist(service, cy, "list-1", first.cursor);
    assert.deepEqual(next.playlistEntries, [
      { id: "entry-1", changedAt: 9, phoneId: "phone-a", deleted: true },
    ]);
    const everything = await pullPlaylist(service, cy, "list-1");
    assert.deepEqual(
      everything.playlistEntries.map((row) => row.id),
      ["entry-1"],
    );
  });

  test("comes in pages, and Core reads each as a pull page", async () => {
    const { service, ana, bo } = await shared({ pullPageSize: 2 });
    await push(service, ana, {
      playlistEntries: ["a", "b", "c", "d"].map((id) => entry(id, "list-1")),
    });
    const pulled = await pullPlaylist(service, bo, "list-1");
    assert.equal(pulled.pages, 3);
    assert.deepEqual(
      pulled.playlistEntries.map((row) => row.id),
      ["entry-1", "a", "b", "c", "d"],
    );
    const response = await memberPull(service, bo, "list-1");
    const page = readPullPage(await response.text());
    assert.equal(page?.playlists.length, 1);
    assert.equal(page?.playlistEntries.length, 1);
    assert.equal(page?.more, true);
  });

  test("tells a non-member from a failure, and needs a playlist and a cursor", async () => {
    const { service, bo, stranger } = await shared();
    assert.deepEqual(await refusal(await memberPull(service, stranger, "list-1")), [
      403,
      "not_member",
    ]);
    assert.deepEqual(await refusal(await memberPull(service, bo, "own-1")), [403, "not_member"]);
    assert.deepEqual(await refusal(await memberPull(service, bo, "list-1", "-1")), [
      400,
      "bad_request",
    ]);
    const noPlaylist = await service.request("GET", "/v1/collaboration/pull", { session: bo });
    assert.deepEqual(await refusal(noPlaylist), [400, "bad_request"]);
  });

  test("the owner's deletion of the playlist ends it for the members", async () => {
    const { service, ana, bo, cy } = await shared();
    const first = await pullPlaylist(service, bo, "list-1");
    await push(service, ana, {
      playlists: [{ id: "list-1", changedAt: 9, phoneId: "phone-a", deleted: true }],
    });
    for (const session of [bo, cy]) {
      const pulled = await pull(service, session);
      assert.deepEqual(pulled.collaborations, []);
      assert.deepEqual(pulled.endedCollaborations, [
        { playlistId: "list-1", reason: "ended", endedAt: service.now },
      ]);
    }
    assert.deepEqual(await refusal(await memberPull(service, bo, "list-1", first.cursor)), [
      403,
      "not_member",
    ]);
    // The owner's own pull no longer lists it either.
    assert.deepEqual((await pull(service, ana)).collaborations, []);
  });

  test("the owner's deletion leaves out the live entries the same push sends into it", async () => {
    const { service, ana } = await shared();
    await push(service, ana, {
      playlists: [{ id: "list-1", changedAt: 9, phoneId: "phone-a", deleted: true }],
      playlistEntries: [
        entry("late-1", "list-1", { changedAt: 9 }),
        { id: "entry-1", changedAt: 9, phoneId: "phone-a", deleted: true },
      ],
    });
    const pulled = await pullAll(service, ana);
    assert.equal(byId(pulled.playlistEntries, "late-1"), undefined);
    assert.equal(byId(pulled.playlistEntries, "entry-1")?.deleted, true);
  });

  test("a playlist that passed to another owner is pulled again from the start", async () => {
    const { service, ana, cy } = await shared();
    const first = await pullPlaylist(service, cy, "list-1");
    assert.equal((await requestAccountDeletion(service, ana)).status, 204);
    const next = await pullPlaylist(service, cy, "list-1", first.cursor);
    assert.deepEqual(
      next.playlists.map((row) => row.id),
      ["list-1"],
    );
    assert.deepEqual(
      next.playlistEntries.map((row) => row.id),
      ["entry-1"],
    );
  });
});

describe("the owner's own push of a collaborative playlist", () => {
  test("names the owner on the entries it adds, and on those from before it was collaborative", async () => {
    const { service, ana, ids } = await shared();
    await push(service, ana, { playlistEntries: [entry("ana-2", "list-1")] });
    const owners = await pullAll(service, ana);
    assert.equal(byId(owners.playlistEntries, "ana-2")?.addedBy, ids.ana);
    const members = await pullPlaylist(service, ana, "list-1");
    assert.equal(byId(members.playlistEntries, "entry-1")?.addedBy, ids.ana);
  });

  test("fills a Library entry that arrives with its recording key alone from the owner's song", async () => {
    const { service, ana, bo } = await shared();
    await push(service, ana, { songs: [song("key-sun")] });
    await push(service, ana, {
      playlistEntries: [entry("ana-2", "list-1", { songId: "key-sun", ytSong: null })],
    });
    const pulled = byId((await pullPlaylist(service, bo, "list-1")).playlistEntries, "ana-2");
    assert.equal(pulled?.title, "Here Comes the Sun");
    assert.equal(pulled?.credit, "The Beatles");
    assert.equal(pulled?.album, "Abbey Road");
    assert.equal(pulled?.durationMs, 185_000);
    assert.equal(pulled?.videoId, "vid-sun");
  });

  test("keeps the fields an older app leaves out of an entry it moves", async () => {
    const { service, ana, bo } = await shared();
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [libraryEntry("bo-1", "list-1", { videoId: "vid-1" })],
      }),
    );
    // Ana's older app moves it, sending only the fields it knows.
    await push(service, ana, {
      playlistEntries: [
        entry("bo-1", "list-1", {
          changedAt: 9,
          orderKey: "z0",
          songId: "key-bo-1",
          ytSong: null,
        }),
      ],
    });
    const pulled = byId((await pullPlaylist(service, bo, "list-1")).playlistEntries, "bo-1");
    assert.equal(pulled?.orderKey, "z0");
    assert.equal(pulled?.title, "Something");
    assert.equal(pulled?.videoId, "vid-1");
  });

  test("bounds the rows the owner writes too", async () => {
    const { service, ana, bo } = await shared();
    await push(service, ana, {
      playlists: [playlist("list-1", { changedAt: 5, name: "n".repeat(5_000) })],
      playlistEntries: [
        entry("ana-2", "list-1", {
          ytSong: ytSong("ana-2", { artworkUrl: "https://example.com/cover.jpg" }),
        }),
      ],
    });
    const pulled = await pullPlaylist(service, bo, "list-1");
    assert.equal(String(byId(pulled.playlists, "list-1")?.name).length, 300);
    const stored = JSON.parse(String(byId(pulled.playlistEntries, "ana-2")?.ytSong)) as {
      artworkUrl: unknown;
    };
    assert.equal(stored.artworkUrl, null);
    // The owner's ordinary playlist is not touched.
    await push(service, ana, {
      playlists: [playlist("own-1", { changedAt: 5, name: "n".repeat(5_000) })],
    });
    assert.equal(
      String(byId((await pullAll(service, ana)).playlists, "own-1")?.name).length,
      5_000,
    );
  });
});

describe("the validation of a collaborative playlist's rows", () => {
  test("drops a cover outside YouTube's and Google's image hosts and bounds the texts", async () => {
    const { service, bo } = await shared();
    const long = "x".repeat(1_000);
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlists: [playlist("list-1", { changedAt: 5, name: long })],
        playlistEntries: [
          entry("bo-1", "list-1", {
            ytSong: ytSong("bo-1", {
              title: long,
              artists: [long],
              album: long,
              artworkUrl: "https://tracker.example.com/pixel.gif",
            }),
          }),
          libraryEntry("bo-2", "list-1", { title: long, credit: long, album: long }),
          entry("bo-3", "list-1"),
        ],
      }),
    );
    const pulled = await pullPlaylist(service, bo, "list-1");
    const cut = "x".repeat(300);
    assert.equal(byId(pulled.playlists, "list-1")?.name, cut);
    assert.deepEqual(JSON.parse(String(byId(pulled.playlistEntries, "bo-1")?.ytSong)), {
      ...JSON.parse(ytSong("bo-1")),
      title: cut,
      artists: [cut],
      album: cut,
      artworkUrl: null,
    });
    const library = byId(pulled.playlistEntries, "bo-2");
    assert.deepEqual([library?.title, library?.credit, library?.album], [cut, cut, cut]);
    assert.equal(byId(pulled.playlistEntries, "bo-3")?.ytSong, ytSong("bo-3"));
  });

  test("a push past 2,000 songs in the list is refused", async () => {
    const { service, ana, bo } = await shared({
      limits: { maxCollaborativeSongs: 3, maxCollaborativeEntries: 10 },
    });
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [entry("b1", "list-1"), entry("b2", "list-1")],
      }),
    );
    const response = await memberPush(service, bo, "list-1", {
      playlistEntries: [entry("b3", "list-1")],
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "limit", limit: "maxCollaborativeSongs" });
    // The owner's push is refused the same way, and her own playlist isn't counted.
    const owners = await service.request("POST", "/v1/push", {
      session: ana,
      json: { playlistEntries: [entry("a3", "list-1")] },
    });
    assert.equal(owners.status, 413);
    await push(service, ana, {
      playlistEntries: ["o1", "o2", "o3"].map((id) => entry(id, "own-1")),
    });
    // A removed entry makes room in the list.
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [
          {
            ...entry("b1", "list-1"),
            changedAt: 5,
            deleted: true,
            removedAt: 5,
          },
          entry("b3", "list-1"),
        ],
      }),
    );
    assert.equal(byId((await pullPlaylist(service, bo, "list-1")).playlistEntries, "b3")?.id, "b3");
  });

  test("a push past 10,000 entries with the removed ones is refused", async () => {
    const { service, bo } = await shared({
      limits: { maxCollaborativeSongs: 10, maxCollaborativeEntries: 3 },
    });
    await accepted(
      await memberPush(service, bo, "list-1", {
        playlistEntries: [{ ...entry("b1", "list-1"), deleted: true, removedAt: 1 }],
      }),
    );
    await accepted(
      await memberPush(service, bo, "list-1", { playlistEntries: [entry("b2", "list-1")] }),
    );
    const response = await memberPush(service, bo, "list-1", {
      playlistEntries: [{ ...entry("b3", "list-1"), deleted: true, removedAt: 1 }],
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "limit", limit: "maxCollaborativeEntries" });
  });
});

describe("who added an entry, over time", () => {
  test("an entry from before entries named who added them names the owner once collaborative", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const bo = await service.signIn(BO);
    await push(service, ana, {
      playlists: [playlist("list-1")],
      playlistEntries: [entry("old-1", "list-1")],
    });
    // As the service held it before the column.
    await service.db.execute("UPDATE playlist_entries SET added_by = NULL");
    const made = await service.request("POST", "/v1/collaboration", {
      session: ana,
      json: { playlistId: "list-1" },
    });
    assert.equal(made.status, 200);
    const ids = {
      ana: await accountId(service.db, "google-sub-1"),
      bo: await accountId(service.db, BO.sub),
    };
    assert.equal(await addMember(service.db, "list-1", ids.bo, service.now), true);
    const pulled = await pullPlaylist(service, bo, "list-1");
    assert.equal(byId(pulled.playlistEntries, "old-1")?.addedBy, ids.ana);
  });

  test("the entries of a deleted account stay and name no one", async () => {
    const { service, ana, bo, ids } = await shared();
    await accepted(
      await memberPush(service, bo, "list-1", { playlistEntries: [entry("bo-1", "list-1")] }),
    );
    assert.equal((await requestAccountDeletion(service, bo, BO)).status, 204);
    const pulled = await pullPlaylist(service, ana, "list-1");
    assert.equal(byId(pulled.playlistEntries, "bo-1")?.addedBy, null);
    const named = await service.db.execute({
      sql: "SELECT count(*) AS n FROM playlist_entries WHERE added_by = ?",
      args: [ids.bo],
    });
    assert.equal(Number(named.rows[0]?.n), 0);
  });

  test("an entry removed outright passes to the next owner with the playlist", async () => {
    const { service, ana, bo } = await shared();
    const before = (await pullAll(service, bo)).cursor;
    await push(service, ana, {
      playlistEntries: [{ id: "entry-1", changedAt: 9, phoneId: "phone-a", deleted: true }],
    });
    assert.equal((await requestAccountDeletion(service, ana)).status, 204);
    const pulled = await pullAll(service, bo, before);
    assert.deepEqual(byId(pulled.playlistEntries, "entry-1"), {
      id: "entry-1",
      changedAt: 9,
      phoneId: "phone-a",
      deleted: true,
    });
  });
});
