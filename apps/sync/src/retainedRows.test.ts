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
});
