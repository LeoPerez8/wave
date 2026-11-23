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

describe("PUT /v1/account/photo", () => {
  const put = (service: Harness, session: string | undefined, json: unknown): Promise<Response> =>
    service.request(
      "PUT",
      "/v1/account/photo",
      session === undefined ? { json } : { session, json },
    );

  /** The photo the members of [session]'s playlist [playlistId] see for its account. */
  const seenPhoto = async (
    service: Harness,
    session: string,
    playlistId?: string,
  ): Promise<unknown> =>
    (await madeCollaborative(service, session, playlistId)).members.find((member) => member.self)
      ?.photoUrl;

  test("stores an accepted address for the session's account, and no other", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const bo = await service.signIn(BO);
    const response = await put(service, ana, { photoUrl: PHOTO });
    assert.equal(response.status, 204);
    assert.equal(await seenPhoto(service, ana), PHOTO);
    assert.equal(await seenPhoto(service, bo, "list-2"), null);
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

  test("a missing, non-https or non-Google address answers 400 and keeps the photo there was", async () => {
    const service = await harness();
    const ana = await service.signIn({ picture: PHOTO });
    for (const body of [
      {},
      { photoUrl: "" },
      { photoUrl: null },
      { photoUrl: 7 },
      { photoUrl: "http://lh3.googleusercontent.com/a/ACg8ocAna=s96-c" },
      { photoUrl: "https://example.com/ana.jpg" },
      { photoUrl: "https://googleusercontent.com.example.com/a" },
      PHOTO,
      null,
    ]) {
      const response = await put(service, ana, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "bad_request" });
    }
    assert.equal(await seenPhoto(service, ana), PHOTO);
  });

  test("without a session it answers 401 and stores nothing", async () => {
    const service = await harness();
    const ana = await service.signIn();
    assert.equal((await put(service, undefined, { photoUrl: PHOTO })).status, 401);
    assert.equal((await put(service, "x".repeat(43), { photoUrl: PHOTO })).status, 401);
    assert.equal(await seenPhoto(service, ana), null);
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
