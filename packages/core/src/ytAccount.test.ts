import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_ACCOUNT_SIGNED_OUT,
  catalogueOf,
  confirmYtMusicOff,
  planAlert,
  stepYtAccount,
  ytAccountView,
  ytSignInEmail,
  ytSignInFollowsWave,
} from "./index.ts";
import type { WaveSession, YtAccount, YtAccountState, YtSession } from "./index.ts";

const leo: YtAccount = {
  name: "Leo Perez",
  email: "leo@example.com",
  photoUrl: "https://yt3.ggpht.com/leo=s108",
};
const withSession = (session: YtSession): YtAccountState => ({ ...YT_ACCOUNT_SIGNED_OUT, session });
const signedIn = withSession({ status: "signedIn", account: leo });

describe("ytAccountView", () => {
  test("signed out, Settings offers Sign In and says it's optional", () => {
    assert.deepEqual(ytAccountView(YT_ACCOUNT_SIGNED_OUT, true), {
      kind: "signedOut",
      action: "signIn",
      note: "optional",
    });
  });

  test("signed in, Settings shows the account's name and picture and offers Sign Out", () => {
    assert.deepEqual(ytAccountView(signedIn, true), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });

  test("an expired session shows as signed out, asking to sign in again", () => {
    const expired: YtAccountState = withSession({ status: "expired", account: leo });
    assert.deepEqual(ytAccountView(expired, true), {
      kind: "signedOut",
      action: "signInAgain",
      note: "expired",
    });
  });

  test("with YT Music off there's no Sign In, since signing in talks to Google", () => {
    assert.equal(ytAccountView(YT_ACCOUNT_SIGNED_OUT, false), null);
    const expired: YtAccountState = withSession({ status: "expired", account: null });
    assert.equal(ytAccountView(expired, false), null);
  });

  test("with YT Music off a signed-in account can still be signed out of", () => {
    assert.deepEqual(ytAccountView(signedIn, false), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });
});

describe("stepYtAccount", () => {
  test("Sign In is busy until the sign-in page returns, then the account shows", () => {
    const signingIn = stepYtAccount(YT_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    assert.deepEqual(ytAccountView(signingIn, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "optional",
    });
    const done = stepYtAccount(signingIn, {
      type: "signInEnded",
      outcome: { status: "signedIn", account: leo },
    });
    assert.deepEqual(ytAccountView(done, true), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });

  test("a sign-in that fails says why in a quiet line, and Sign In can be tried again", () => {
    const signingIn = stepYtAccount(YT_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    const offline = stepYtAccount(signingIn, { type: "signInFailed", reason: "offline" });
    assert.deepEqual(ytAccountView(offline, true), {
      kind: "signedOut",
      action: "signIn",
      note: "offline",
    });
    const retried = stepYtAccount(offline, { type: "signInStarted" });
    assert.deepEqual(ytAccountView(retried, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "optional",
    });
  });

  test("backing out of the sign-in page leaves the account as it was", () => {
    const expired = withSession({ status: "expired", account: leo });
    const signingIn = stepYtAccount(expired, { type: "signInStarted" });
    assert.deepEqual(stepYtAccount(signingIn, { type: "signInCancelled" }), expired);
  });

  test("a session that ends while Settings is open shows as soon as Wave hears of it", () => {
    const ended = stepYtAccount(signedIn, {
      type: "sessionChanged",
      session: { status: "expired", account: leo },
    });
    assert.deepEqual(ytAccountView(ended, true), {
      kind: "signedOut",
      action: "signInAgain",
      note: "expired",
    });
  });

  test("signing out shows Sign In again, without the old prompt or failure", () => {
    const failed = stepYtAccount(withSession({ status: "expired", account: leo }), {
      type: "signInFailed",
      reason: "failed",
    });
    const signedOut = stepYtAccount(failed, {
      type: "sessionChanged",
      session: { status: "signedOut" },
    });
    assert.deepEqual(ytAccountView(signedOut, true), {
      kind: "signedOut",
      action: "signIn",
      note: "optional",
    });
  });

  test("while the sign-in page is open, news of the old session keeps the button waiting", () => {
    const signingIn = stepYtAccount(signedIn, { type: "signInStarted" });
    const ended = stepYtAccount(signingIn, {
      type: "sessionChanged",
      session: { status: "expired", account: leo },
    });
    assert.deepEqual(ytAccountView(ended, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "expired",
    });
  });
});

describe("ytSignInFollowsWave", () => {
  const wave: WaveSession = {
    status: "signedIn",
    account: { email: "ana@example.com", name: null, photoUrl: null },
  };

  test("a Wave account sign-in opens YT Music's when it's on and signed out", () => {
    assert.equal(ytSignInFollowsWave(wave, true, { status: "signedOut" }), true);
  });

  test("YT Music off, or a YouTube account already kept, opens nothing", () => {
    assert.equal(ytSignInFollowsWave(wave, false, { status: "signedOut" }), false);
    assert.equal(ytSignInFollowsWave(wave, true, { status: "signedIn", account: leo }), false);
    assert.equal(ytSignInFollowsWave(wave, true, { status: "expired", account: leo }), false);
  });

  test("a Wave session that isn't signed in opens nothing", () => {
    assert.equal(
      ytSignInFollowsWave({ status: "signedOut" }, true, { status: "signedOut" }),
      false,
    );
    assert.equal(
      ytSignInFollowsWave({ status: "ended", account: wave.account }, true, {
        status: "signedOut",
      }),
      false,
    );
  });
});

test("YT Music sign-in prefers the expired account, then Wave, then asks for an email", () => {
  const wave: WaveSession = {
    status: "signedIn",
    account: { email: "wave@example.com", name: null, photoUrl: null },
  };
  assert.equal(ytSignInEmail({ status: "expired", account: leo }, wave), "leo@example.com");
  assert.equal(
    ytSignInEmail({ status: "expired", account: { ...leo, email: null } }, wave),
    "wave@example.com",
  );
  assert.equal(ytSignInEmail({ status: "signedOut" }, wave), "wave@example.com");
  assert.equal(
    ytSignInEmail({ status: "signedOut" }, { status: "ended", account: wave.account }),
    null,
  );
});

describe("confirmYtMusicOff", () => {
  const lost = [
    "Wave stops sending requests to YouTube. You lose:",
    "• Online search and streamed songs",
    "• DJ, Discover and Community playlists on Home",
    "• Magic Queue and playlist suggestions",
    "• Downloads, imports and Export through YT Music",
    "Downloaded songs keep playing and nothing is deleted.",
  ];

  test("says what stops, with a red Turn Off beside Cancel", () => {
    const alert = confirmYtMusicOff(false);
    assert.equal(alert.title, "Turn Off YT Music?");
    assert.equal(alert.message, lost.join("\n"));
    assert.deepEqual(
      planAlert(alert).buttons.map(({ label, tone }) => [label, tone]),
      [
        ["Cancel", "accent"],
        ["Turn Off", "destructive"],
      ],
    );
  });

  test("signed in to a Wave account, adds that every phone of the account turns it off", () => {
    assert.equal(
      confirmYtMusicOff(true).message,
      [...lost, "This applies to every phone signed in to your Wave account."].join("\n"),
    );
  });

  test("reads in Portuguese, with and without the account's line", () => {
    const pt = catalogueOf("pt-BR");
    const perdas = [
      "O Wave para de fazer pedidos ao YouTube. Você perde:",
      "• Busca online e músicas por streaming",
      "• DJ, Descobrir e Playlists da comunidade no Início",
      "• Fila Mágica e sugestões nas playlists",
      "• Downloads, importações e Exportar pelo YT Music",
      "As músicas baixadas continuam tocando e nada é apagado.",
    ];
    const alert = confirmYtMusicOff(false, pt);
    assert.equal(alert.title, "Desativar o YT Music?");
    assert.equal(alert.message, perdas.join("\n"));
    assert.deepEqual(
      planAlert(alert, pt).buttons.map(({ label }) => label),
      ["Cancelar", "Desativar"],
    );
    assert.equal(
      confirmYtMusicOff(true, pt).message,
      [...perdas, "Vale para todos os seus celulares com a Conta Wave."].join("\n"),
    );
  });
});
