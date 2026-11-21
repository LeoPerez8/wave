import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { collaborationService, type CollaborationTransport } from "./collaborationService.ts";

const LIST = "5f0c1a2b3c4d5e6f708192a3b4c5d6e7";
const TOKEN = "B".repeat(43);

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
}

/** A transport that answers [reply] and keeps what was sent, or rejects with [error]. */
const transport = (
  reply: { readonly status: number; readonly body: string },
  error?: unknown,
): CollaborationTransport & { readonly sent: Sent[] } => {
  const sent: Sent[] = [];
  return {
    sent,
    request: async (method, path, body) => {
      sent.push({ method, path, body });
      if (error !== undefined) throw error;
      return reply;
    },
  };
};

const coded = (code: string): Error => Object.assign(new Error(code), { code });

const collaboration = {
  playlistId: LIST,
  members: [{ accountId: "ana", name: "Ana", joinedAt: 1, owner: true, self: true }],
};

describe("collaborationService", () => {
  test("each route goes through the transport and answers what the service did", async () => {
    const service = transport({ status: 200, body: JSON.stringify(collaboration) });
    const calls = collaborationService(service);
    assert.deepEqual(await calls.join(TOKEN), { type: "done", value: collaboration });
    assert.deepEqual(service.sent, [
      { method: "POST", path: "/v1/invite/join", body: `{"token":"${TOKEN}"}` },
    ]);
  });

  test("every call of the service is there", async () => {
    const service = transport({ status: 204, body: "" });
    const calls = collaborationService(service);
    await calls.setAccountName("Ana");
    await calls.make(LIST);
    await calls.end(LIST);
    await calls.members(LIST);
    await calls.removeMember(LIST, "bea");
    await calls.leave(LIST);
    await calls.createInvite(LIST);
    await calls.readInvite(LIST);
    await calls.turnOffInvite(LIST);
    await calls.lookUpInvite(TOKEN);
    await calls.join(TOKEN);
    await calls.push(LIST, "{}");
    await calls.pull(LIST, "3");
    assert.deepEqual(
      service.sent.map(({ method, path }) => `${method} ${path.split("?")[0]}`),
      [
        "PUT /v1/account/name",
        "POST /v1/collaboration",
        "DELETE /v1/collaboration",
        "GET /v1/collaboration/members",
        "DELETE /v1/collaboration/members",
        "DELETE /v1/collaboration/membership",
        "POST /v1/collaboration/invite",
        "GET /v1/collaboration/invite",
        "DELETE /v1/collaboration/invite",
        "POST /v1/invite",
        "POST /v1/invite/join",
        "POST /v1/collaboration/push",
        "GET /v1/collaboration/pull",
      ],
    );
  });

  test("a refusal is told apart from a failure and from being offline", async () => {
    const refused = collaborationService(
      transport({ status: 410, body: '{"error":"invite_ended"}' }),
    );
    assert.deepEqual(await refused.join(TOKEN), { type: "refused", refusal: "linkNotValid" });

    const failing = collaborationService(transport({ status: 503, body: '{"error":"busy"}' }));
    assert.deepEqual(await failing.members(LIST), { type: "failed", status: 503 });

    const offline = collaborationService(
      transport({ status: 0, body: "" }, coded("ERR_WAVE_OFFLINE")),
    );
    assert.deepEqual(await offline.members(LIST), { type: "offline" });
  });

  test("nothing sent (signed out, out of reach, the session ended) is a failure", async () => {
    for (const code of [
      "ERR_WAVE_SIGNED_OUT",
      "ERR_WAVE_UNREACHABLE",
      "ERR_WAVE_SESSION_ENDED",
      "ERR_WAVE_FORBIDDEN_REQUEST",
    ]) {
      const calls = collaborationService(transport({ status: 0, body: "" }, coded(code)));
      assert.deepEqual(await calls.leave(LIST), { type: "failed", status: null }, code);
    }
  });

  test("an error that isn't the account's is not hidden", async () => {
    const calls = collaborationService(transport({ status: 0, body: "" }, new TypeError("bug")));
    await assert.rejects(calls.leave(LIST), TypeError);
  });
});
