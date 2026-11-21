import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  inviteHost,
  inviteJoinOutcome,
  inviteJoinView,
  inviteLookUpOutcome,
  inviteOpening,
  inviteSignInNotice,
  inviteToken,
} from "./index.ts";

const SYNC = "https://wave-sync.example.workers.dev";
const TOKEN = "9fK2xQ-_" + "a".repeat(35);
const LINK = `${SYNC}/invite#${TOKEN}`;
const ANA = { email: "ana@example.com", name: "Ana Souza", photoUrl: null };

describe("inviteToken", () => {
  test("reads the token of the sync service's invite link", () => {
    assert.equal(inviteToken(LINK, SYNC), TOKEN);
  });

  test("finds the link among the words a share brings", () => {
    assert.equal(inviteToken(`Join my playlist on Wave: ${LINK} see you`, SYNC), TOKEN);
  });

  test("takes the host in any case and a trailing slash on the service's address", () => {
    assert.equal(inviteToken(LINK.replace("wave-sync", "WAVE-SYNC"), `${SYNC}/`), TOKEN);
  });

  test("is null for another host, another path, plain http or a token of the wrong shape", () => {
    for (const text of [
      `https://evil.example.com/invite#${TOKEN}`,
      `https://wave-sync.example.workers.dev.evil.com/invite#${TOKEN}`,
      `${SYNC}/invites#${TOKEN}`,
      `${SYNC}/invite?t=${TOKEN}`,
      `http://wave-sync.example.workers.dev/invite#${TOKEN}`,
      `${SYNC}/invite#${TOKEN.slice(1)}`,
      `${SYNC}/invite#${TOKEN}x`,
      `${SYNC}/invite#${TOKEN.slice(1)}!`,
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      assert.equal(inviteToken(text, SYNC), null, text);
    }
  });

  test("the host is the sync service's, for the link filter", () => {
    assert.equal(inviteHost(`${SYNC}/`), "wave-sync.example.workers.dev");
  });
});

describe("inviteOpening", () => {
  test("signed out asks to sign in, signed in looks the invite up", () => {
    assert.equal(inviteOpening({ signedIn: false }), "signIn");
    assert.equal(inviteOpening({ signedIn: true }), "lookUp");
  });
});

describe("inviteLookUpOutcome", () => {
  const details = { playlistId: "list", playlistName: "Rolê de sexta", ownerName: "Leo Perez" };

  test("a link the service names opens the join screen", () => {
    assert.deepEqual(inviteLookUpOutcome({ type: "done", value: details }, "en"), {
      kind: "join",
      details,
    });
  });

  test("each refusal has its own message, in both languages", () => {
    const notValid = inviteLookUpOutcome({ type: "refused", refusal: "linkNotValid" }, "en");
    const full = inviteLookUpOutcome(
      { type: "refused", refusal: "full", limit: "maxAccounts" },
      "en",
    );
    assert.deepEqual(notValid, {
      kind: "notice",
      notice: {
        title: "This invite is no longer valid",
        message: "Ask whoever invited you for a new link.",
      },
    });
    assert.deepEqual(full, {
      kind: "notice",
      notice: {
        title: "The service is full",
        message: "Wave can't take new accounts right now, so you can't join this playlist.",
      },
    });
    assert.deepEqual(inviteLookUpOutcome({ type: "refused", refusal: "linkNotValid" }, "pt-BR"), {
      kind: "notice",
      notice: {
        title: "Este convite não vale mais",
        message: "Peça um link novo a quem convidou você.",
      },
    });
  });

  test("offline and a failure say so, without a refusal's message", () => {
    assert.deepEqual(inviteLookUpOutcome({ type: "offline" }, "en"), {
      kind: "notice",
      notice: {
        title: "Couldn't open the invite",
        message: "Connect to the internet, then tap the link again.",
      },
    });
    assert.deepEqual(inviteLookUpOutcome({ type: "failed", status: 500 }, "en"), {
      kind: "notice",
      notice: { title: "Couldn't open the invite", message: "Try again in a moment." },
    });
  });
});

describe("inviteJoinView", () => {
  test("names the owner, the playlist, what joining allows and the account that joins", () => {
    assert.deepEqual(
      inviteJoinView(
        { playlistId: "list", playlistName: "Rolê de sexta", ownerName: "Leo Perez" },
        ANA,
        "en",
      ),
      {
        invitedBy: "Leo Perez invited you to",
        playlistName: "Rolê de sexta",
        allows: "You'll be able to add, remove and reorder songs with the other members.",
        join: "Join",
        cancel: "Cancel",
        joiningAs: "You join as Ana Souza",
      },
    );
  });

  test("in Brazilian Portuguese, as the mock words it", () => {
    const view = inviteJoinView(
      { playlistId: "list", playlistName: "Rolê de sexta", ownerName: "Leo Perez" },
      ANA,
      "pt-BR",
    );
    assert.equal(view.invitedBy, "Leo Perez convidou você para");
    assert.equal(view.join, "Entrar");
    assert.equal(view.cancel, "Cancelar");
    assert.equal(view.joiningAs, "Você entra como Ana Souza");
  });

  test("without names it still reads, with the email when the account has no name", () => {
    const view = inviteJoinView(
      { playlistId: "list", playlistName: null, ownerName: null },
      { ...ANA, name: null },
      "en",
    );
    assert.equal(view.invitedBy, "You're invited to");
    assert.equal(view.playlistName, "A collaborative playlist");
    assert.equal(view.joiningAs, "You join as ana@example.com");
  });
});

describe("inviteJoinOutcome", () => {
  const collaboration = {
    playlistId: "list",
    members: [{ accountId: "leo", name: "Leo", joinedAt: 1, owner: true, self: false }],
  };

  test("joining gives the playlist to wait for", () => {
    assert.deepEqual(inviteJoinOutcome({ type: "done", value: collaboration }, "en"), {
      kind: "joined",
      playlistId: "list",
    });
  });

  test("a link that ended meanwhile, or a full service, says which", () => {
    assert.deepEqual(inviteJoinOutcome({ type: "refused", refusal: "linkNotValid" }, "en"), {
      kind: "notice",
      notice: {
        title: "This invite is no longer valid",
        message: "Ask whoever invited you for a new link.",
      },
    });
    const full = inviteJoinOutcome({ type: "refused", refusal: "full" }, "pt-BR");
    assert.deepEqual(full, {
      kind: "notice",
      notice: {
        title: "O serviço está cheio",
        message: "O Wave não aceita contas novas agora, então não dá para entrar nesta playlist.",
      },
    });
  });

  test("a failure to join says it didn't join", () => {
    assert.deepEqual(inviteJoinOutcome({ type: "failed", status: null }, "en"), {
      kind: "notice",
      notice: { title: "Couldn't join the playlist", message: "Try again in a moment." },
    });
    assert.deepEqual(inviteJoinOutcome({ type: "offline" }, "en"), {
      kind: "notice",
      notice: {
        title: "Couldn't join the playlist",
        message: "Connect to the internet, then tap the link again.",
      },
    });
  });
});

describe("inviteSignInNotice", () => {
  test("a service with no room for the account says it is full", () => {
    const full = {
      title: "The service is full",
      message: "Wave can't take new accounts right now, so you can't join this playlist.",
    };
    assert.deepEqual(inviteSignInNotice("accountsFull", "en"), full);
    assert.deepEqual(inviteSignInNotice("newAccountsPaused", "en"), full);
  });

  test("any other failure gives Settings' reason", () => {
    assert.deepEqual(inviteSignInNotice("offline", "en"), {
      title: "Couldn't sign in",
      message: "Couldn't sign in without a connection.",
    });
  });
});
