import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  membershipChanges,
  privateCopyId,
  readPullMembership,
  refusalEndsMembership,
  type HeldCollaboration,
  type PullMembership,
} from "./index.ts";

const LIST = "5f0c1a2b3c4d5e6f708192a3b4c5d6e7";
const OTHER = "00112233445566778899aabbccddeeff";
const ANA = "ana-account";
const BEA = "bea-account";
const CAIO = "caio-account";

const member = (accountId: string, owner: boolean, self: boolean, joinedAt = 1) => ({
  accountId,
  name: accountId,
  joinedAt,
  owner,
  self,
});

describe("readPullMembership", () => {
  test("reads the collaborations and the ended ones a pull page states", () => {
    const body = JSON.stringify({
      cursor: "4",
      more: false,
      playlists: [],
      collaborations: [
        { playlistId: LIST, members: [member(ANA, true, false), member(BEA, false, true)] },
      ],
      endedCollaborations: [
        { playlistId: OTHER, reason: "left", endedAt: 10 },
        { playlistId: "x", reason: "who knows", endedAt: 11 },
      ],
    });
    assert.deepEqual(readPullMembership(body), {
      collaborations: [
        { playlistId: LIST, members: [member(ANA, true, false), member(BEA, false, true)] },
      ],
      ended: [{ playlistId: OTHER, reason: "left", endedAt: 10 }],
    });
  });

  test("is null for a page from a service from before collaborations", () => {
    assert.equal(readPullMembership(JSON.stringify({ cursor: "4", more: false })), null);
    assert.equal(readPullMembership("not json"), null);
  });
});

const held = (playlistId: string, owned: boolean, ownerAccountId: string): HeldCollaboration => ({
  playlistId,
  owned,
  ownerAccountId,
});

const pulled = (
  collaborations: PullMembership["collaborations"],
  ended: PullMembership["ended"] = [],
): PullMembership => ({ collaborations, ended });

describe("membershipChanges", () => {
  test("a playlist the account joined is kept, as a member's, pulled from no cursor", () => {
    const changes = membershipChanges(
      [],
      pulled([{ playlistId: LIST, members: [member(ANA, true, false), member(BEA, false, true)] }]),
    );
    assert.deepEqual(changes.keep, [
      {
        playlistId: LIST,
        owned: false,
        ownerAccountId: ANA,
        members: [member(ANA, true, false), member(BEA, false, true)],
        restartPull: true,
      },
    ]);
    assert.deepEqual([changes.leave, changes.privateCopy, changes.forget], [[], [], []]);
  });

  test("the account's own collaborative playlist is kept as owned", () => {
    const changes = membershipChanges(
      [held(LIST, true, ANA)],
      pulled([{ playlistId: LIST, members: [member(ANA, true, true), member(BEA, false, false)] }]),
    );
    assert.equal(changes.keep[0]?.owned, true);
    assert.equal(changes.keep[0]?.restartPull, false);
  });

  test("a playlist whose owner changed is pulled again from no cursor", () => {
    const members = [member(CAIO, true, false, 2), member(BEA, false, true, 3)];
    const changes = membershipChanges(
      [held(LIST, false, ANA)],
      pulled([{ playlistId: LIST, members }]),
    );
    assert.deepEqual(changes.keep[0], {
      playlistId: LIST,
      owned: false,
      ownerAccountId: CAIO,
      members,
      restartPull: true,
    });
  });

  test("leaving removes the playlist, and an end or a removal keeps a private copy", () => {
    const changes = membershipChanges(
      [held(LIST, false, ANA), held(OTHER, false, CAIO)],
      pulled(
        [],
        [
          { playlistId: LIST, reason: "left", endedAt: 5 },
          { playlistId: OTHER, reason: "ended", endedAt: 6 },
        ],
      ),
    );
    assert.deepEqual(changes, { keep: [], leave: [LIST], privateCopy: [OTHER], forget: [] });
  });

  test("a member's playlist missing from both lists is kept as a private copy", () => {
    const changes = membershipChanges([held(LIST, false, ANA)], pulled([]));
    assert.deepEqual(changes.privateCopy, [LIST]);
  });

  test("the owner's playlist that ended is only forgotten: it stays the owner's own", () => {
    const changes = membershipChanges([held(LIST, true, ANA)], pulled([]));
    assert.deepEqual(changes, { keep: [], leave: [], privateCopy: [], forget: [LIST] });
  });

  test("an end of a playlist the device doesn't hold changes nothing", () => {
    const changes = membershipChanges(
      [],
      pulled([], [{ playlistId: LIST, reason: "ended", endedAt: 1 }]),
    );
    assert.deepEqual(changes, { keep: [], leave: [], privateCopy: [], forget: [] });
  });
});

describe("privateCopyId", () => {
  test("is the same on every device, a sync id, and another than the playlist's", () => {
    const copy = privateCopyId(LIST);
    assert.equal(copy, privateCopyId(LIST));
    assert.match(copy, /^[0-9a-f]{32}$/);
    assert.notEqual(copy, LIST);
    assert.notEqual(privateCopyId(OTHER), copy);
  });
});

describe("refusalEndsMembership", () => {
  test("a refusal for not being a member, or for a deleted playlist, ends it", () => {
    assert.equal(refusalEndsMembership("notMember"), true);
    assert.equal(refusalEndsMembership("deleted"), true);
  });

  test("a full playlist or any other refusal only stops that playlist until the next cycle", () => {
    for (const refusal of ["full", "notOwner", "notFound", "taken", "linkNotValid"] as const) {
      assert.equal(refusalEndsMembership(refusal), false, refusal);
    }
  });
});
