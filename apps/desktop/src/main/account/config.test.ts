import assert from "node:assert/strict";
import { test } from "node:test";
import { accountConfig } from "./config.ts";

const BUILT = {
  MAIN_VITE_WAVE_SYNC_URL: "https://sync.wave.test/",
  MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID: "desktop-client",
};

test("a build with the service's URL and the Desktop client has Sign In", () => {
  assert.deepEqual(accountConfig(BUILT, {}, true), {
    syncUrl: "https://sync.wave.test",
    clientId: "desktop-client",
    clientSecret: undefined,
    tokenUrl: "https://oauth2.googleapis.com/token",
  });
});

test("a build missing either has no Sign In", () => {
  for (const built of [
    { MAIN_VITE_WAVE_SYNC_URL: "https://sync.wave.test" },
    { MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID: "desktop-client" },
    { ...BUILT, MAIN_VITE_WAVE_SYNC_URL: " " },
  ])
    assert.equal(accountConfig(built, {}, true).syncUrl, null);
});

test("the session goes only over HTTPS, but a local service is fine for an unpackaged run", () => {
  assert.equal(
    accountConfig({ ...BUILT, MAIN_VITE_WAVE_SYNC_URL: "http://sync.wave.test" }, {}, true).syncUrl,
    null,
  );
  assert.equal(
    accountConfig({ ...BUILT, MAIN_VITE_WAVE_SYNC_URL: "http://127.0.0.1:8787" }, {}, true).syncUrl,
    null,
  );
  assert.equal(
    accountConfig({ ...BUILT, MAIN_VITE_WAVE_SYNC_URL: "http://127.0.0.1:8787" }, {}, false)
      .syncUrl,
    "http://127.0.0.1:8787",
  );
});

test("an unpackaged run may point at another service and client; a packaged one may not", () => {
  const runtime = {
    WAVE_SYNC_URL: "https://staging.wave.test",
    WAVE_GOOGLE_DESKTOP_CLIENT_ID: "staging-client",
    WAVE_GOOGLE_DESKTOP_CLIENT_SECRET: "staging-secret",
  };
  assert.deepEqual(accountConfig(BUILT, runtime, false), {
    syncUrl: "https://staging.wave.test",
    clientId: "staging-client",
    clientSecret: "staging-secret",
    tokenUrl: "https://oauth2.googleapis.com/token",
  });
  assert.deepEqual(accountConfig(BUILT, runtime, true), {
    syncUrl: "https://sync.wave.test",
    clientId: "desktop-client",
    clientSecret: undefined,
    tokenUrl: "https://oauth2.googleapis.com/token",
  });
});

test("an unpackaged run may trade Google's code at a local stand-in, and nowhere else", () => {
  const GOOGLE = "https://oauth2.googleapis.com/token";
  assert.equal(accountConfig(BUILT, {}, true).tokenUrl, GOOGLE);
  const local = { WAVE_GOOGLE_TOKEN_URL: "http://127.0.0.1:4000/token" };
  assert.equal(accountConfig(BUILT, local, false).tokenUrl, "http://127.0.0.1:4000/token");
  assert.equal(accountConfig(BUILT, local, true).tokenUrl, GOOGLE);
  for (const elsewhere of ["https://tokens.example.com/token", "http://tokens.example.com/", "x"])
    assert.equal(
      accountConfig(BUILT, { WAVE_GOOGLE_TOKEN_URL: elsewhere }, false).tokenUrl,
      GOOGLE,
    );
  // A build can't carry one either.
  assert.equal(
    accountConfig(
      { ...BUILT, MAIN_VITE_WAVE_GOOGLE_TOKEN_URL: local.WAVE_GOOGLE_TOKEN_URL },
      {},
      false,
    ).tokenUrl,
    GOOGLE,
  );
});
