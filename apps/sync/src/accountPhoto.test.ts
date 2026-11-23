import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addMember } from "./collaborations.ts";
import { migrate } from "./migrations.ts";
import { type Harness, type TokenClaims, freshDatabase, harness, pull, push } from "./testing.ts";

const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocAna=s96-c";
const NEW_PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocAna2=s96-c";
const BO = { sub: "google-sub-2", email: "bo@example.com", name: "Bo Lima" };

const playlist = (id: string) => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  name: "Road trip",
  createdAt: 1_700_000_000_000,
});

interface Member {
  readonly accountId: string;
  readonly name: string | null;
  readonly photoUrl: string | null;
  readonly self: boolean;
}

interface Listed {
  readonly playlistId: string;
  readonly members: readonly Member[];
}

/** Makes [playlistId] collaborative for [session] (again changes nothing) and gives its members. */
const madeCollaborative = async (
  service: Harness,
  session: string,
  playlistId = "list-1",
): Promise<Listed> => {
  await push(service, session, { playlists: [playlist(playlistId)] });
  const response = await service.request("POST", "/v1/collaboration", {
    session,
    json: { playlistId },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as Listed;
};

/** The photo the members of a playlist see for the account [claims] sign in to. */
const photoAfterSignIn = async (service: Harness, claims?: TokenClaims): Promise<unknown> => {
  const session = await service.signIn(claims);
  const listed = await madeCollaborative(service, session);
  return listed.members.find((member) => member.self)?.photoUrl;
};

describe("a sign-in keeps the Google account's photo", () => {
  test("the token's photo is what the members see", async () => {
    const service = await harness();
    assert.equal(await photoAfterSignIn(service, { picture: PHOTO }), PHOTO);
  });

  test("a later sign-in with another photo replaces it", async () => {
    const service = await harness();
    await photoAfterSignIn(service, { picture: PHOTO });
    assert.equal(await photoAfterSignIn(service, { picture: NEW_PHOTO }), NEW_PHOTO);
  });

  test("a token without a photo leaves none, so the initial comes back", async () => {
    const service = await harness();
    await photoAfterSignIn(service, { picture: PHOTO });
    assert.equal(await photoAfterSignIn(service), null);
  });

  test("an address off Google's photo host counts as none", async () => {
    const service = await harness();
    await photoAfterSignIn(service, { picture: PHOTO });
    for (const picture of ["https://example.com/ana.jpg", "http://lh3.googleusercontent.com/a", 7])
      assert.equal(await photoAfterSignIn(service, { picture }), null);
  });
});

describe("who sees a member's photo", () => {
  test("every member sees each member's photo; a member without one shows none", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana Souza", picture: PHOTO });
    const bo = await service.signIn(BO);
    await madeCollaborative(service, ana);
    const boId = (
      await service.db.execute({
        sql: "SELECT id FROM accounts WHERE google_sub = ?",
        args: [BO.sub],
      })
    ).rows[0]?.id;
    assert.equal(await addMember(service.db, "list-1", String(boId), service.now), true);

    for (const session of [ana, bo]) {
      const pulled = await pull(service, session);
      assert.deepEqual(
        pulled.collaborations[0]?.members.map(({ name, photoUrl }) => ({ name, photoUrl })),
        [
          { name: "Ana Souza", photoUrl: PHOTO },
          { name: "Bo Lima", photoUrl: null },
        ],
      );
      const listed = await service.request("GET", "/v1/collaboration/members?playlist=list-1", {
        session,
      });
      assert.equal(listed.status, 200);
      assert.deepEqual(
        ((await listed.json()) as Listed).members.map(({ photoUrl }) => photoUrl),
        [PHOTO, null],
      );
    }
  });

  test("an account outside the playlist sees no one's photo", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana Souza", picture: PHOTO });
    const stranger = await service.signIn(BO);
    await madeCollaborative(service, ana);

    const listed = await service.request("GET", "/v1/collaboration/members?playlist=list-1", {
      session: stranger,
    });
    assert.equal(listed.status, 403);
    assert.ok(!(await listed.text()).includes(PHOTO));
    assert.deepEqual((await pull(service, stranger)).collaborations, []);
  });
});

describe("PUT /v1/account/name with a photo", () => {
  const put = (service: Harness, session: string | undefined, json: unknown): Promise<Response> =>
    service.request(
      "PUT",
      "/v1/account/name",
      session === undefined ? { json } : { session, json },
    );

  /** The name and photo the members of [session]'s playlist [playlistId] see for its account. */
  const seen = async (
    service: Harness,
    session: string,
    playlistId?: string,
  ): Promise<{ readonly name: unknown; readonly photoUrl: unknown }> => {
    const self = (await madeCollaborative(service, session, playlistId)).members.find(
      (member) => member.self,
    );
    return { name: self?.name, photoUrl: self?.photoUrl };
  };

  test("stores an accepted photo for the session's account, and no other", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana Souza" });
    const bo = await service.signIn(BO);
    const response = await put(service, ana, { photoUrl: PHOTO });
    assert.equal(response.status, 204);
    assert.deepEqual(await seen(service, ana), { name: "Ana Souza", photoUrl: PHOTO });
    assert.deepEqual(await seen(service, bo, "list-2"), { name: "Bo Lima", photoUrl: null });
  });

  test("stores the name and the photo of one body", async () => {
    const service = await harness();
    const ana = await service.signIn();
    assert.equal((await put(service, ana, { name: "Ana Souza", photoUrl: PHOTO })).status, 204);
    assert.deepEqual(await seen(service, ana), { name: "Ana Souza", photoUrl: PHOTO });
  });

  test("after the send, another member's pull returns that photo", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana Souza" });
    const bo = await service.signIn(BO);
    await madeCollaborative(service, ana);
    const boId = (
      await service.db.execute({
        sql: "SELECT id FROM accounts WHERE google_sub = ?",
        args: [BO.sub],
      })
    ).rows[0]?.id;
    assert.equal(await addMember(service.db, "list-1", String(boId), service.now), true);

    assert.equal((await put(service, ana, { photoUrl: PHOTO })).status, 204);
    const pulled = await pull(service, bo);
    assert.deepEqual(
      pulled.collaborations[0]?.members.map(({ name, photoUrl }) => ({ name, photoUrl })),
      [
        { name: "Ana Souza", photoUrl: PHOTO },
        { name: "Bo Lima", photoUrl: null },
      ],
    );
  });

  test("a photo that isn't accepted is ignored, and the body's name is still stored", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana", picture: PHOTO });
    for (const photoUrl of [
      "",
      null,
      7,
      "http://lh3.googleusercontent.com/a/ACg8ocAna=s96-c",
      "https://example.com/ana.jpg",
      "https://googleusercontent.com.example.com/a",
    ]) {
      const name = `Ana ${String(photoUrl).length}`;
      assert.equal((await put(service, ana, { name, photoUrl })).status, 204);
      assert.deepEqual(await seen(service, ana), { name, photoUrl: PHOTO });
    }
  });

  test("a body with neither an accepted name nor an accepted photo answers 400 and changes nothing", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana Souza", picture: PHOTO });
    for (const body of [
      {},
      { photoUrl: "" },
      { photoUrl: "https://example.com/ana.jpg" },
      { name: "  ", photoUrl: "http://lh3.googleusercontent.com/a/ACg8ocAna=s96-c" },
      { name: 7, photoUrl: 7 },
      PHOTO,
      null,
    ]) {
      const response = await put(service, ana, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "bad_request" });
    }
    assert.deepEqual(await seen(service, ana), { name: "Ana Souza", photoUrl: PHOTO });
  });

  test("without a session it answers 401 and stores nothing", async () => {
    const service = await harness();
    const ana = await service.signIn({ name: "Ana Souza" });
    for (const session of [undefined, "x".repeat(43)])
      assert.equal(
        (await put(service, session, { name: "Ana Lima", photoUrl: PHOTO })).status,
        401,
      );
    assert.deepEqual(await seen(service, ana), { name: "Ana Souza", photoUrl: null });
  });

  test("there is no route of its own for the photo", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const response = await service.request("PUT", "/v1/account/photo", {
      session: ana,
      json: { photoUrl: PHOTO },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await seen(service, ana), { name: null, photoUrl: null });
  });
});

describe("the migration", () => {
  test("adds the photo to the accounts there were, as none until they sign in", async () => {
    const db = await freshDatabase({ until: "0019_collaborative_entries" });
    await db.execute({
      sql: `INSERT INTO accounts (id, google_sub, email, name, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: ["account-1", "google-sub-1", "ana@example.com", "Ana Souza", Date.UTC(2026, 0, 1)],
    });
    const accounts = async () =>
      (await db.execute("SELECT * FROM accounts")).rows.map((row) => ({ ...row }));
    const [before] = await accounts();

    assert.deepEqual(await migrate(db, { until: "0020_account_photo" }), ["0020_account_photo"]);

    const [after] = await accounts();
    assert.equal(after?.photo_url, null);
    for (const column of ["id", "google_sub", "email", "name", "created_at", "change_seq"])
      assert.equal(after?.[column], before?.[column]);

    // One place in all: the sign-in works only as the account that was already there.
    await migrate(db);
    const service = await harness({ limits: { maxAccounts: 1 } }, db);
    assert.equal(await photoAfterSignIn(service, { picture: PHOTO }), PHOTO);
  });
});
