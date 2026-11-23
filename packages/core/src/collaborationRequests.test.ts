import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountNameCall,
  accountPhotoCall,
  collaborationAnswer,
  createInviteCall,
  endCollaborationCall,
  isCollaborationRequest,
  joinInviteCall,
  leaveCollaborationCall,
  lookUpInviteCall,
  makeCollaborationCall,
  membersCall,
  playlistPullCall,
  playlistPushCall,
  readCollaborationMember,
  readInviteCall,
  removeMemberCall,
  turnOffInviteCall,
  type CollaborationCall,
} from "./index.ts";

const LIST = "5f0c1a2b3c4d5e6f708192a3b4c5d6e7";
const ANA = "0b6e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const TOKEN = "A".repeat(43);
const PHOTO = "https://lh3.googleusercontent.com/a/ana=s96-c";

const collaboration = {
  playlistId: LIST,
  members: [
    {
      accountId: ANA,
      name: "Ana Souza",
      photoUrl: PHOTO,
      joinedAt: 1,
      owner: true,
      self: true,
    },
    { accountId: "bea", name: null, photoUrl: null, joinedAt: 2, owner: false, self: false },
  ],
};

const every: readonly CollaborationCall<unknown>[] = [
  accountNameCall("Ana Souza"),
  accountPhotoCall(PHOTO),
  makeCollaborationCall(LIST),
  endCollaborationCall(LIST),
  membersCall(LIST),
  removeMemberCall(LIST, ANA),
  leaveCollaborationCall(LIST),
  createInviteCall(LIST),
  readInviteCall(LIST),
  turnOffInviteCall(LIST),
  lookUpInviteCall(TOKEN),
  joinInviteCall(TOKEN),
  playlistPushCall(LIST, "{}"),
  playlistPullCall(LIST, null),
  playlistPullCall(LIST, "17"),
];

describe("collaboration requests", () => {
  test("each route of the sync service is called as its README names it", () => {
    assert.deepEqual(
      every.map(({ request }) => request),
      [
        { method: "PUT", path: "/v1/account/name", body: '{"name":"Ana Souza"}' },
        { method: "PUT", path: "/v1/account/photo", body: `{"photoUrl":"${PHOTO}"}` },
        { method: "POST", path: "/v1/collaboration", body: `{"playlistId":"${LIST}"}` },
        { method: "DELETE", path: `/v1/collaboration?playlist=${LIST}`, body: null },
        { method: "GET", path: `/v1/collaboration/members?playlist=${LIST}`, body: null },
        {
          method: "DELETE",
          path: `/v1/collaboration/members?playlist=${LIST}&account=${ANA}`,
          body: null,
        },
        { method: "DELETE", path: `/v1/collaboration/membership?playlist=${LIST}`, body: null },
        { method: "POST", path: "/v1/collaboration/invite", body: `{"playlistId":"${LIST}"}` },
        { method: "GET", path: `/v1/collaboration/invite?playlist=${LIST}`, body: null },
        { method: "DELETE", path: `/v1/collaboration/invite?playlist=${LIST}`, body: null },
        { method: "POST", path: "/v1/invite", body: `{"token":"${TOKEN}"}` },
        { method: "POST", path: "/v1/invite/join", body: `{"token":"${TOKEN}"}` },
        { method: "POST", path: `/v1/collaboration/push?playlist=${LIST}`, body: "{}" },
        { method: "GET", path: `/v1/collaboration/pull?playlist=${LIST}`, body: null },
        { method: "GET", path: `/v1/collaboration/pull?playlist=${LIST}&since=17`, body: null },
      ],
    );
  });

  test("an invite token goes in the body, never in a path", () => {
    for (const call of [lookUpInviteCall(TOKEN), joinInviteCall(TOKEN)])
      assert.ok(!call.request.path.includes(TOKEN));
  });

  test("every request a call makes passes the check the phone and the desktop apply", () => {
    for (const { request } of every)
      assert.ok(isCollaborationRequest(request.method, request.path), request.path);
  });

  test("the check refuses other methods, other routes and other query shapes", () => {
    for (const [method, path] of [
      ["GET", "/v1/collaboration"],
      ["PUT", "/v1/collaboration"],
      ["POST", "/v1/collaboration?playlist=x"],
      ["GET", "/v1/account/name"],
      ["GET", "/v1/account/photo"],
      ["PUT", "/v1/account/photo?x=1"],
      ["DELETE", "/v1/account"],
      ["DELETE", "/v1/collaboration"],
      ["DELETE", "/v1/collaboration?playlist="],
      ["DELETE", "/v1/collaboration?playlist=a/../../soulseek"],
      ["DELETE", "/v1/collaboration?playlist=a%2F.."],
      ["DELETE", "/v1/collaboration?playlist=a&account=b"],
      ["GET", "/v1/collaboration/members?playlist=a&account=b"],
      ["DELETE", "/v1/collaboration/members?playlist=a"],
      ["DELETE", "/v1/collaboration/members?account=b&playlist=a"],
      ["POST", "/v1/collaboration/membership?playlist=a"],
      ["GET", "/v1/invite"],
      ["POST", "/v1/invite?token=abc"],
      ["GET", "/v1/collaboration/pull?playlist=a&since=1&more=1"],
      ["GET", "/v1/collaboration/pull?since=1&playlist=a"],
      ["POST", "/v1/collaboration/push"],
      ["POST", "/v1/collaboration/push?playlist=a#x"],
      ["GET", "/invite"],
      ["POST", "/v1/push"],
    ] as const)
      assert.equal(isCollaborationRequest(method, path), false, `${method} ${path}`);
  });

  test("a call answered 2xx gives what its route answers", () => {
    assert.deepEqual(collaborationAnswer(membersCall(LIST), 200, JSON.stringify(collaboration)), {
      type: "done",
      value: collaboration,
    });
    assert.deepEqual(collaborationAnswer(leaveCollaborationCall(LIST), 204, ""), {
      type: "done",
      value: null,
    });
    assert.deepEqual(
      collaborationAnswer(
        createInviteCall(LIST),
        200,
        '{"url":"https://sync.example/invite#abc","expiresAt":9}',
      ),
      { type: "done", value: { url: "https://sync.example/invite#abc", expiresAt: 9 } },
    );
    assert.deepEqual(
      collaborationAnswer(readInviteCall(LIST), 200, '{"invite":{"createdAt":1,"expiresAt":9}}'),
      { type: "done", value: { createdAt: 1, expiresAt: 9 } },
    );
    assert.deepEqual(collaborationAnswer(readInviteCall(LIST), 200, '{"invite":null}'), {
      type: "done",
      value: null,
    });
    assert.deepEqual(
      collaborationAnswer(
        lookUpInviteCall(TOKEN),
        200,
        `{"playlistId":"${LIST}","playlistName":"Road trip","ownerName":null}`,
      ),
      { type: "done", value: { playlistId: LIST, playlistName: "Road trip", ownerName: null } },
    );
    assert.deepEqual(
      collaborationAnswer(joinInviteCall(TOKEN), 200, JSON.stringify(collaboration)),
      { type: "done", value: collaboration },
    );
    assert.deepEqual(
      collaborationAnswer(
        playlistPushCall(LIST, "{}"),
        200,
        '{"accepted":{},"corrected":{"playlistEntries":[{"id":"e1","changedAt":5}]}}',
      ),
      {
        type: "done",
        value: { corrected: [{ table: "playlistEntries", id: "e1", changedAt: 5 }] },
      },
    );
    const pulled = collaborationAnswer(
      playlistPullCall(LIST, null),
      200,
      '{"playlists":[],"playlistEntries":[],"cursor":"4","more":false}',
    );
    assert.equal(pulled.type, "done");
    assert.equal(pulled.type === "done" && pulled.value.cursor, "4");
  });

  test("a member list leaves out what isn't a member's and keeps no email", () => {
    const answer = collaborationAnswer(
      membersCall(LIST),
      200,
      JSON.stringify({
        playlistId: LIST,
        members: [
          { ...collaboration.members[0], email: "ana@example.com" },
          { accountId: 7, name: "?", joinedAt: 1, owner: false, self: false },
          "nobody",
        ],
      }),
    );
    assert.deepEqual(answer, {
      type: "done",
      value: { playlistId: LIST, members: [collaboration.members[0]] },
    });
  });

  test("a member the service sends without a photo reads as having none", () => {
    // A service from before photos were kept, or a record the client stored before them.
    const { photoUrl: _, ...withoutPhoto } = collaboration.members[0]!;
    const answer = collaborationAnswer(
      membersCall(LIST),
      200,
      JSON.stringify({ playlistId: LIST, members: [withoutPhoto] }),
    );
    assert.deepEqual(answer, {
      type: "done",
      value: { playlistId: LIST, members: [{ ...withoutPhoto, photoUrl: null }] },
    });
  });

  test("a photo address off Google's photo host reads as none, and the member stays", () => {
    for (const photoUrl of ["https://example.com/a.jpg", "http://lh3.googleusercontent.com/a", 7]) {
      const answer = collaborationAnswer(
        membersCall(LIST),
        200,
        JSON.stringify({ playlistId: LIST, members: [{ ...collaboration.members[0], photoUrl }] }),
      );
      assert.deepEqual(answer, {
        type: "done",
        value: { playlistId: LIST, members: [{ ...collaboration.members[0], photoUrl: null }] },
      });
    }
  });

  test("a 2xx answer that isn't the route's shape is a failure", () => {
    const cases: readonly [CollaborationCall<unknown>, string][] = [
      [membersCall(LIST), "{}"],
      [joinInviteCall(TOKEN), "not json"],
      [createInviteCall(LIST), '{"url":1}'],
      [readInviteCall(LIST), "{}"],
      [lookUpInviteCall(TOKEN), '{"playlistId":"x"}'],
      [playlistPullCall(LIST, null), "{}"],
    ];
    for (const [call, body] of cases)
      assert.deepEqual(collaborationAnswer(call, 200, body), { type: "failed", status: 200 });
  });

  test("each refusal of the service reaches the caller as its own result", () => {
    const cases: readonly [CollaborationCall<unknown>, number, string, unknown][] = [
      [membersCall(LIST), 403, '{"error":"not_member"}', { refusal: "notMember" }],
      [endCollaborationCall(LIST), 403, '{"error":"not_owner"}', { refusal: "notOwner" }],
      [
        leaveCollaborationCall(LIST),
        403,
        '{"error":"owner_cannot_leave"}',
        { refusal: "ownerCannotLeave" },
      ],
      [playlistPushCall(LIST, "{}"), 403, '{"error":"deleted"}', { refusal: "deleted" }],
      [makeCollaborationCall(LIST), 404, '{"error":"not_found"}', { refusal: "notFound" }],
      [makeCollaborationCall(LIST), 409, '{"error":"taken"}', { refusal: "taken" }],
      [lookUpInviteCall(TOKEN), 404, '{"error":"not_found"}', { refusal: "linkNotValid" }],
      [joinInviteCall(TOKEN), 404, '{"error":"not_found"}', { refusal: "linkNotValid" }],
      [joinInviteCall(TOKEN), 410, '{"error":"invite_ended"}', { refusal: "linkNotValid" }],
      [
        playlistPushCall(LIST, "{}"),
        413,
        '{"error":"limit","limit":"maxCollaborativeSongs"}',
        { refusal: "full", limit: "maxCollaborativeSongs" },
      ],
      [
        joinInviteCall(TOKEN),
        403,
        '{"error":"limit","limit":"maxAccounts"}',
        { refusal: "full", limit: "maxAccounts" },
      ],
    ];
    for (const [call, status, body, expected] of cases)
      assert.deepEqual(
        collaborationAnswer(call, status, body),
        { type: "refused", ...(expected as object) },
        `${call.request.path} ${status} ${body}`,
      );
  });

  test("an answer that isn't a refusal is a failure, with its status", () => {
    for (const [status, body] of [
      [400, '{"error":"bad_request"}'],
      [429, '{"error":"limit","limit":"maxRequestsPerMinute"}'],
      [500, '{"error":"internal"}'],
      [503, '{"error":"busy"}'],
      [403, '{"error":"something_new"}'],
      [404, "<html>"],
      [302, ""],
    ] as const)
      assert.deepEqual(collaborationAnswer(membersCall(LIST), status, body), {
        type: "failed",
        status,
      });
  });
});

describe("readCollaborationMember", () => {
  test("reads a member as the service sends it", () => {
    assert.deepEqual(readCollaborationMember(collaboration.members[0]), collaboration.members[0]);
  });

  test("a member kept before photos were kept reads as having none", () => {
    const { photoUrl: _, ...stored } = collaboration.members[0]!;
    assert.deepEqual(readCollaborationMember(stored), { ...stored, photoUrl: null });
  });

  test("gives null for what isn't a member", () => {
    assert.equal(readCollaborationMember("ana"), null);
    assert.equal(readCollaborationMember({ ...collaboration.members[0], accountId: 7 }), null);
  });
});
