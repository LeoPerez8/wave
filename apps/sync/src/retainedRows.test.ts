import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Harness, favorite, harness, pull, push } from "./testing.ts";

/** A favorite's deletion record. */
const tombstone = (id: string, changedAt = 2) => ({
  id,
  changedAt,
  phoneId: "phone-a",
  deleted: true,
});

/** Pushes [body] and asserts it's refused for [limit]. */
const refusedPush = async (
  service: Harness,
  session: string,
  body: unknown,
  limit: string,
): Promise<void> => {
  const response = await service.request("POST", "/v1/push", { session, json: body });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "limit", limit });
};

describe("retained sync rows", () => {
  test("a deletion record for a new ID counts against the category's limit", async () => {
    const service = await harness({ limits: { maxFavorites: 2 } });
    const session = await service.signIn();
    await push(service, session, { favorites: [favorite("a", 1), tombstone("b")] });
    const before = await pull(service, session);

    await refusedPush(service, session, { favorites: [tombstone("c")] }, "maxFavorites");
    assert.deepEqual(await pull(service, session), before);
  });

  test("a category already past its limit keeps its rows, takes non-growing changes and refuses new IDs", async () => {
    const legacy = await harness({ limits: { maxFavorites: 3 } });
    const session = await legacy.signIn();
    await push(legacy, session, {
      favorites: [favorite("a", 1), tombstone("b"), favorite("c", 1)],
    });
    const service = await harness({ limits: { maxFavorites: 2 } }, legacy.db);

    await push(service, session, {
      favorites: [favorite("a", 3), favorite("b", 3), tombstone("c", 3)],
    });
    const after = await pull(service, session);
    assert.deepEqual(
      after.favorites.map((row) => [row.id, row.deleted, row.changedAt]),
      [
        ["a", false, 3],
        ["b", false, 3],
        ["c", true, 3],
      ],
    );

    await refusedPush(service, session, { favorites: [favorite("d", 4)] }, "maxFavorites");
    await refusedPush(service, session, { favorites: [tombstone("d", 4)] }, "maxFavorites");
    assert.deepEqual(await pull(service, session), after);
  });
});
