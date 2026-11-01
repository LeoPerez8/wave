import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { UPDATES_ORIGIN } from "./layout.ts";
import { publishUpdate } from "./publish.ts";
import { createUpdateService } from "./service.ts";
import { memoryStorage } from "./testing.ts";

const ORIGIN = "https://updates.test";

// Throwaway pairs made for the test run. Nothing here is Wave's key.
const pem = () =>
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
const shipped = pem();
const another = pem();

const askFor = (
  storage: ReturnType<typeof memoryStorage>,
  headers: Record<string, string> = {},
): Promise<Response> =>
  createUpdateService(storage).fetch(
    new Request(`${ORIGIN}/v1/manifest`, {
      headers: {
        "expo-protocol-version": "1",
        "expo-platform": "android",
        "expo-channel-name": "ti",
        "expo-runtime-version": "native-a",
        ...headers,
      },
    }),
  );

// `expo export`'s output for one bundle and one image.
const exported = (bundle: string, image = "image"): string => {
  const dir = mkdtempSync(join(tmpdir(), "wave-update-"));
  mkdirSync(join(dir, "_expo/static/js/android"), { recursive: true });
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "_expo/static/js/android/index.hbc"), bundle);
  writeFileSync(join(dir, "assets/abc"), image);
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      version: 0,
      bundler: "metro",
      fileMetadata: {
        android: {
          bundle: "_expo/static/js/android/index.hbc",
          assets: [{ path: "assets/abc", ext: "png" }],
        },
      },
    }),
  );
  return dir;
};

let clock = Date.parse("2026-10-31T12:00:00.000Z");
let ids = 0;

const publish = (
  storage: ReturnType<typeof memoryStorage>,
  overrides: Partial<Parameters<typeof publishUpdate>[0]> = {},
) =>
  publishUpdate({
    dir: exported("bundle"),
    channel: "ti",
    runtimeVersion: "native-a",
    appConfig: { name: "Wave", version: "1.2.3-ti", extra: { syncUrl: "https://sync.test" } },
    origin: ORIGIN,
    signingKey: shipped.privateKey,
    put: storage.put,
    now: () => (clock += 1000),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    ...overrides,
  });

// The `manifest` part of a multipart/mixed answer, as expo-updates reads it.
const manifestOf = async (response: Response) => {
  const boundary = /boundary=(\S+)/.exec(response.headers.get("content-type") ?? "")?.[1];
  assert.ok(boundary, "the answer is multipart");
  const parts = (await response.text()).split(`--${boundary}`);
  const part = parts.find((text) => /name="manifest"/.test(text));
  assert.ok(part, "the answer has a manifest part");
  return JSON.parse(part.slice(part.indexOf("\r\n\r\n") + 4).trim());
};

// The `manifest` part as expo-updates' signature check sees it: its exact body and its header.
const signedPart = async (response: Response) => {
  const boundary = /boundary=(\S+)/.exec(response.headers.get("content-type") ?? "")?.[1];
  const part = (await response.text())
    .split(`--${boundary}`)
    .find((text) => /name="manifest"/.test(text));
  assert.ok(part, "the answer has a manifest part");
  const headerEnd = part.indexOf("\r\n\r\n");
  const header = /^expo-signature: (.*)$/im.exec(part.slice(0, headerEnd))?.[1]?.trim();
  assert.ok(header, "the manifest part has an expo-signature header");
  return { header, body: part.slice(headerEnd + 4, part.lastIndexOf("\r\n")) };
};

// What expo-updates' CodeSigningConfiguration does: SHA256withRSA over the body's UTF-8 bytes.
const accepts = (publicKey: string, part: { header: string; body: string }) => {
  const signature = /(?:^|, )sig="([^"]+)"/.exec(part.header)?.[1];
  assert.ok(signature, "the header's sig is a quoted string");
  return createVerify("RSA-SHA256")
    .update(Buffer.from(part.body, "utf8"))
    .verify(publicKey, signature, "base64");
};

const base64urlSha256 = (text: string) => createHash("sha256").update(text).digest("base64url");

describe("GET /v1/manifest", () => {
  it("answers a published update in the expo-updates protocol", async () => {
    const storage = memoryStorage();
    const id = await publish(storage, { dir: exported("the bundle", "the image") });

    const response = await askFor(storage);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("expo-protocol-version"), "1");
    assert.equal(response.headers.get("expo-sfv-version"), "0");
    assert.match(response.headers.get("cache-control") ?? "", /max-age=0/);
    const manifest = await manifestOf(response);
    assert.equal(manifest.id, id);
    assert.equal(manifest.runtimeVersion, "native-a");
    assert.equal(manifest.launchAsset.hash, base64urlSha256("the bundle"));
    assert.equal(manifest.launchAsset.contentType, "application/javascript");
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0].hash, base64urlSha256("the image"));
    assert.equal(manifest.assets[0].fileExtension, ".png");
    assert.equal(manifest.assets[0].contentType, "image/png");
    assert.ok(manifest.assets[0].url.startsWith(`${ORIGIN}/v1/assets/`));
  });

  it("carries the app config, which Constants.expoConfig reads under an update", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const { extra } = await manifestOf(await askFor(storage));
    assert.equal(extra.expoClient.version, "1.2.3-ti");
    assert.equal(extra.expoClient.extra.syncUrl, "https://sync.test");
  });

  it("answers the newest of a channel's updates", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const newest = await publish(storage);
    assert.equal((await manifestOf(await askFor(storage))).id, newest);
  });

  it("answers 204 when nothing was published", async () => {
    const response = await askFor(memoryStorage());
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("expo-protocol-version"), "1");
  });

  it("answers 204 to a phone already running the newest update", async () => {
    const storage = memoryStorage();
    const id = await publish(storage);
    const response = await askFor(storage, { "expo-current-update-id": id });
    assert.equal(response.status, 204);
  });

  it("never gives one channel the other's update", async () => {
    const storage = memoryStorage();
    const ti = await publish(storage, { channel: "ti" });
    assert.equal((await askFor(storage, { "expo-channel-name": "main" })).status, 204);
    const main = await publish(storage, { channel: "main" });
    const mainAnswer = await askFor(storage, { "expo-channel-name": "main" });
    assert.equal((await manifestOf(mainAnswer)).id, main);
    assert.equal((await manifestOf(await askFor(storage))).id, ti);
  });

  it("never gives a runtime version another's update", async () => {
    const storage = memoryStorage();
    const older = await publish(storage, { runtimeVersion: "native-a" });
    // A native change: the new update reaches only the APKs built with it.
    const newer = await publish(storage, { runtimeVersion: "native-b" });
    assert.equal((await manifestOf(await askFor(storage))).id, older);
    const answer = await askFor(storage, { "expo-runtime-version": "native-b" });
    assert.equal((await manifestOf(answer)).id, newer);
    assert.equal((await askFor(storage, { "expo-runtime-version": "native-c" })).status, 204);
  });

  it("gives a build with no channel nothing", async () => {
    const storage = memoryStorage();
    await publish(storage);
    assert.equal((await askFor(storage, { "expo-channel-name": "none" })).status, 400);
  });

  for (const [header, value] of [
    ["expo-platform", "ios"],
    ["expo-protocol-version", "0"],
    ["expo-runtime-version", ""],
  ] as const) {
    it(`refuses ${header}: "${value}"`, async () => {
      assert.equal((await askFor(memoryStorage(), { [header]: value })).status, 400);
    });
  }
});

describe("a signed update", () => {
  it("is accepted by a phone holding the matching certificate", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const part = await signedPart(await askFor(storage, { "expo-expect-signature": "sig" }));
    assert.equal(accepts(shipped.publicKey, part), true);
    assert.match(part.header, /keyid="main"/);
    assert.match(part.header, /alg="rsa-v1_5-sha256"/);
  });

  it("is rejected by a phone holding another key's certificate", async () => {
    const storage = memoryStorage();
    await publish(storage);
    assert.equal(accepts(another.publicKey, await signedPart(await askFor(storage))), false);
  });

  it("stays valid with non-ASCII text in the app config", async () => {
    const storage = memoryStorage();
    await publish(storage, { appConfig: { name: "Wavê ♪" } });
    assert.equal(accepts(shipped.publicKey, await signedPart(await askFor(storage))), true);
  });

  it("names its files at the origin it was signed for, whatever host was asked", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const response = await createUpdateService(storage).fetch(
      new Request("https://elsewhere.test/v1/manifest", {
        headers: {
          "expo-protocol-version": "1",
          "expo-platform": "android",
          "expo-channel-name": "ti",
          "expo-runtime-version": "native-a",
        },
      }),
    );
    const part = await signedPart(response);
    assert.equal(accepts(shipped.publicKey, part), true);
    assert.ok(JSON.parse(part.body).launchAsset.url.startsWith(`${ORIGIN}/v1/assets/`));
  });

  it("is signed for the URL the app asks", () => {
    const appConfig = new URL("../../mobile/app.config.ts", import.meta.url);
    assert.ok(readFileSync(appConfig, "utf8").includes(`url: "${UPDATES_ORIGIN}/v1/manifest"`));
  });
});

describe("GET /v1/assets/<key>", () => {
  it("serves an update's files by the URLs its manifest gives", async () => {
    const storage = memoryStorage();
    await publish(storage, { dir: exported("the bundle", "the image") });
    const manifest = await manifestOf(await askFor(storage));
    const service = createUpdateService(storage);

    const bundle = await service.fetch(new Request(manifest.launchAsset.url));
    assert.equal(bundle.status, 200);
    assert.equal(await bundle.text(), "the bundle");
    assert.match(bundle.headers.get("cache-control") ?? "", /immutable/);

    const image = await service.fetch(new Request(manifest.assets[0].url));
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(await image.text(), "the image");
  });

  it("answers 404 for an asset it doesn't have, or a key that isn't one", async () => {
    const service = createUpdateService(memoryStorage());
    for (const key of ["0".repeat(64), "..%2Fsecret", "updates"]) {
      const response = await service.fetch(new Request(`${ORIGIN}/v1/assets/${key}`));
      assert.equal(response.status, 404);
    }
  });
});

describe("the service", () => {
  it("answers 404 anywhere else and 405 to anything but GET", async () => {
    const service = createUpdateService(memoryStorage());
    assert.equal((await service.fetch(new Request(`${ORIGIN}/`))).status, 404);
    const post = new Request(`${ORIGIN}/v1/manifest`, { method: "POST" });
    assert.equal((await service.fetch(post)).status, 405);
  });
});

describe("publishUpdate", () => {
  it("leaves the channel on its previous update when an upload fails", async () => {
    const storage = memoryStorage();
    const previous = await publish(storage);
    let uploads = 0;
    await assert.rejects(
      publish(storage, {
        dir: exported("a new bundle", "a new image"),
        put: async (key, data, contentType) => {
          uploads += 1;
          if (uploads === 3) throw new Error("network");
          await storage.put(key, data, contentType);
        },
      }),
      /network/,
    );
    assert.equal((await manifestOf(await askFor(storage))).id, previous);
  });

  it("uploads nothing when the signing key is no key", async () => {
    let uploads = 0;
    await assert.rejects(
      publish(memoryStorage(), {
        signingKey: "not a key",
        put: async () => {
          uploads += 1;
        },
      }),
    );
    assert.equal(uploads, 0);
  });

  it("refuses an export with no Android bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-update-"));
    writeFileSync(join(dir, "metadata.json"), JSON.stringify({ fileMetadata: {} }));
    await assert.rejects(publish(memoryStorage(), { dir }), /Android/);
  });
});

describe("scripts/publish.ts", () => {
  // Runs the script with an `npx` that records each upload and whether it could see the key.
  const run = (env: Record<string, string>) => {
    const bin = mkdtempSync(join(tmpdir(), "wave-npx-"));
    const log = join(bin, "uploads.log");
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "$6 key=\${UPDATES_SIGNING_KEY:-none}" >> "${log}"\n`,
    );
    chmodSync(join(bin, "npx"), 0o755);
    const dir = exported("bundle");
    writeFileSync(join(dir, "expo-config.json"), JSON.stringify({ name: "Wave" }));
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/publish.ts", import.meta.url)), dir],
      {
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          CLOUDFLARE_API_TOKEN: "token",
          CLOUDFLARE_ACCOUNT_ID: "account",
          WAVE_UPDATE_CHANNEL: "ti",
          WAVE_RUNTIME_VERSION: "native-a",
          ...env,
        },
      },
    );
    return { output, uploads: existsSync(log) ? readFileSync(log, "utf8") : "" };
  };

  it("skips with a log line and publishes nothing without the signing key", () => {
    const { output, uploads } = run({});
    assert.match(output, /Skipping the over-the-air update: UPDATES_SIGNING_KEY/);
    assert.equal(uploads, "");
  });

  it("publishes with the key and keeps it from what it runs", () => {
    const { output, uploads } = run({ UPDATES_SIGNING_KEY: shipped.privateKey });
    assert.match(output, /Published update/);
    assert.match(uploads, /latest\.json key=none/);
    assert.doesNotMatch(uploads, /PRIVATE KEY/);
  });
});
