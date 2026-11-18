import assert from "node:assert/strict";
import { test } from "node:test";
import {
  challengeData,
  createPoTokens,
  integrityToken,
  poTokenHost,
  tokenText,
  type PoTokenPage,
} from "./poTokens.ts";

const challenge = ["msg", ["js"], ["url"], "hash", "program", "globalName", null, "blob"];

test("BotGuard's challenge is read plain or scrambled", () => {
  const expected = {
    messageId: "msg",
    interpreterJavascript: {
      privateDoNotAccessOrElseSafeScriptWrappedValue: "js",
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: "url",
    },
    interpreterHash: "hash",
    program: "program",
    globalName: "globalName",
    clientExperimentsStateBlob: "blob",
  };
  assert.deepEqual(challengeData(JSON.stringify([challenge])), expected);
  const lowered = Buffer.from(
    Buffer.from(JSON.stringify(challenge)).map((byte) => (byte - 97) & 0xff),
  );
  const scrambled = lowered.toString("base64").replace(/\+/g, "-").replace(/=/g, ".");
  assert.deepEqual(challengeData(JSON.stringify([null, scrambled])), expected);
});

test("the integrity token is read with its lifetime, and a token is written as YouTube wants", () => {
  assert.deepEqual(integrityToken(JSON.stringify(["AQID", 43_200])), {
    bytes: [1, 2, 3],
    lifetimeSeconds: 43_200,
  });
  assert.equal(tokenText([251, 255, 0]), "-_8A", "URL-safe and padded");
  assert.throws(() => integrityToken("[]"));
});

/** A page that mints `<identifier>-token`, counting how often it was set up. */
const fakePage = (log: string[], options: { readonly failMint?: boolean } = {}): PoTokenPage => {
  let dead = false;
  return {
    run: async (script) => {
      if (script.startsWith("runBotGuard")) return "bg-response";
      if (script.startsWith("createPoTokenMinter")) return true;
      const match = /obtainPoToken\(new Uint8Array\(\[([\d,]*)\]\)\)/.exec(script);
      if (match === null) throw new Error(`unexpected ${script.slice(0, 20)}`);
      if (options.failMint) throw new Error("mint failed");
      const identifier = Buffer.from(match[1]!.split(",").map(Number)).toString();
      return [...Buffer.from(`${identifier}-token`)];
    },
    dead: () => dead,
    close: () => {
      dead = true;
      log.push("close");
    },
  };
};

const setup = (now = { ms: 0 }, failMint = false) => {
  const log: string[] = [];
  const tokens = createPoTokens({
    openPage: async () => {
      log.push("open");
      return fakePage(log, { failMint });
    },
    post: async (url, body) => {
      log.push(`post ${url.split("/").pop()} ${body}`);
      return url.endsWith("Create")
        ? JSON.stringify([challenge])
        : JSON.stringify([Buffer.from([1, 2]).toString("base64"), 1_200]);
    },
    now: () => now.ms,
  });
  return { tokens, log, now };
};

const text = (token: string) => Buffer.from(token, "base64url").toString();

test("tokens are minted for the visitor and the video by one page, set up once", async () => {
  const { tokens, log } = setup();
  const first = await tokens.mint(["visitor1", "abcdefghijk"]);
  assert.deepEqual(first.map(text), ["visitor1-token", "abcdefghijk-token"]);
  const second = await tokens.mint(["visitor1", "bcdefghijkl"]);
  assert.deepEqual(second.map(text), ["visitor1-token", "bcdefghijkl-token"]);
  assert.equal(log.filter((line) => line === "open").length, 1);
  assert.ok(log.includes('post GenerateIT ["O43z0dpjhgX20SCx4KAo","bg-response"]'), log.join("\n"));
});

test("a new page is set up when the integrity token runs out or the visitor changes", async () => {
  const { tokens, log, now } = setup();
  await tokens.mint(["visitor1", "abcdefghijk"]);
  // 1 200 s, ten minutes early: it lasts 600 s.
  now.ms = 601_000;
  await tokens.mint(["visitor1", "abcdefghijk"]);
  await tokens.mint(["visitor2", "abcdefghijk"]);
  assert.equal(log.filter((line) => line === "open").length, 3);
  assert.equal(log.filter((line) => line === "close").length, 2);
});

test("a page that can't mint is closed, and the next ask starts over", async () => {
  const { tokens, log } = setup({ ms: 0 }, true);
  await assert.rejects(tokens.mint(["visitor1", "abcdefghijk"]));
  assert.ok(log.includes("close"));
  await assert.rejects(tokens.mint(["visitor1", "abcdefghijk"]));
  assert.equal(log.filter((line) => line === "open").length, 2);
});

test("asks at the same time share one set-up", async () => {
  const { tokens, log } = setup();
  await Promise.all([
    tokens.mint(["visitor1", "abcdefghijk"]),
    tokens.mint(["visitor1", "bcdefghijkl"]),
  ]);
  assert.equal(log.filter((line) => line === "open").length, 1);
});

test("the JVM's poToken call is answered for well-formed identifiers only", async () => {
  const { tokens } = setup();
  const host = poTokenHost(tokens);
  const answer = (await host({ identifiers: ["visitor1", "abcdefghijk"] })) as { tokens: string[] };
  assert.deepEqual(answer.tokens.map(text), ["visitor1-token", "abcdefghijk-token"]);
  await assert.rejects(host({ identifiers: [] }));
  await assert.rejects(host({ identifiers: ["visitor1", 7] }));
  await assert.rejects(host({ identifiers: ["v", "a", "b"] }));
  await assert.rejects(host({ identifiers: ["x".repeat(2_001)] }));
  await assert.rejects(host(null));
});
