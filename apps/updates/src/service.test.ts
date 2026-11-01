import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { publishNotes, publishUpdate } from "./publish.ts";
import { createUpdateService } from "./service.ts";
import { memoryStorage } from "./testing.ts";

const ORIGIN = "https://updates.test";

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

describe("GET /v1/notes", () => {
  const notes = (word: string) => ({
    en: { new: [`${word} in English`], fixes: [] },
    "pt-BR": { new: [`${word} em português`], fixes: [] },
  });

  const release = (
    storage: ReturnType<typeof memoryStorage>,
    version: string,
    channel: "ti" | "main" = "ti",
  ) => publishNotes({ channel, version, notes: notes(version), put: storage.put });

  const askForNotes = (storage: ReturnType<typeof memoryStorage>, query: string) =>
    createUpdateService(storage).fetch(new Request(`${ORIGIN}/v1/notes?${query}`));

  const versions = async (response: Response) =>
    ((await response.json()) as { releases: { version: string }[] }).releases.map(
      (it) => it.version,
    );

  it("answers each release's notes per language, newest first", async () => {
    const storage = memoryStorage();
    await release(storage, "1.2.3-ti");
    await release(storage, "1.2.4-ti");

    const response = await askForNotes(storage, "channel=ti&from=1.2.2-ti&to=1.2.4-ti");

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), {
      releases: [
        { version: "1.2.4-ti", notes: notes("1.2.4-ti") },
        { version: "1.2.3-ti", notes: notes("1.2.3-ti") },
      ],
    });
  });

  it("leaves out the version the phone had and keeps the one it's on", async () => {
    const storage = memoryStorage();
    for (const version of ["1.2.3-ti", "1.2.4-ti", "1.2.5-ti", "1.2.6-ti"])
      await release(storage, version);
    const answer = await askForNotes(storage, "channel=ti&from=1.2.3-ti&to=1.2.5-ti");
    assert.deepEqual(await versions(answer), ["1.2.5-ti", "1.2.4-ti"]);
  });

  it("orders versions by number, not as text", async () => {
    const storage = memoryStorage();
    for (const version of ["1.9.0-ti", "1.10.0-ti", "1.2.0-ti"]) await release(storage, version);
    const answer = await askForNotes(storage, "channel=ti&from=1.1.0-ti&to=1.10.0-ti");
    assert.deepEqual(await versions(answer), ["1.10.0-ti", "1.9.0-ti", "1.2.0-ti"]);
  });

  it("goes up to the newest release with no `to`", async () => {
    const storage = memoryStorage();
    await release(storage, "1.2.3-ti");
    await release(storage, "1.2.4-ti");
    const answer = await askForNotes(storage, "channel=ti&from=1.2.3-ti");
    assert.deepEqual(await versions(answer), ["1.2.4-ti"]);
  });

  it("counts both channels' versions on one sequence, keeping each channel's notes apart", async () => {
    const storage = memoryStorage();
    await release(storage, "1.2.3-ti");
    await release(storage, "1.2.4", "main");
    await release(storage, "1.2.5-ti");
    const ti = await askForNotes(storage, "channel=ti&from=1.2.3&to=1.2.5-ti");
    assert.deepEqual(await versions(ti), ["1.2.5-ti"]);
    const main = await askForNotes(storage, "channel=main&from=1.2.0");
    assert.deepEqual(await versions(main), ["1.2.4"]);
  });

  it("answers no releases when none falls between the versions", async () => {
    const answer = await askForNotes(memoryStorage(), "channel=ti&from=1.2.3-ti");
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { releases: [] });
  });

  it("finds releases past a page of the storage's listing", async () => {
    const storage = memoryStorage({ listPageSize: 2 });
    for (const version of ["1.2.3", "1.2.4", "1.2.5", "1.2.6", "1.2.7"])
      await release(storage, version, "main");
    const answer = await askForNotes(storage, "channel=main&from=1.2.3");
    assert.deepEqual(await versions(answer), ["1.2.7", "1.2.6", "1.2.5", "1.2.4"]);
  });

  for (const query of [
    "from=1.2.3",
    "channel=none&from=1.2.3",
    "channel=ti",
    "channel=ti&from=latest",
    "channel=ti&from=1.2.3&to=1.2",
  ]) {
    it(`refuses ${query}`, async () => {
      assert.equal((await askForNotes(memoryStorage(), query)).status, 400);
    });
  }
});

describe("the service", () => {
  it("answers 404 anywhere else and 405 to anything but GET", async () => {
    const service = createUpdateService(memoryStorage());
    assert.equal((await service.fetch(new Request(`${ORIGIN}/`))).status, 404);
    const post = new Request(`${ORIGIN}/v1/manifest`, { method: "POST" });
    assert.equal((await service.fetch(post)).status, 405);
  });
});

describe("publishNotes", () => {
  it("publishes nothing for a release with no notes to list", async () => {
    const storage = memoryStorage();
    await publishNotes({
      channel: "ti",
      version: "1.2.3-ti",
      notes: { en: { new: [], fixes: [] }, "pt-BR": { new: [], fixes: [] } },
      put: storage.put,
    });
    const answer = await createUpdateService(storage).fetch(
      new Request(`${ORIGIN}/v1/notes?channel=ti&from=1.0.0`),
    );
    assert.deepEqual(await answer.json(), { releases: [] });
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

  it("refuses an export with no Android bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-update-"));
    writeFileSync(join(dir, "metadata.json"), JSON.stringify({ fileMetadata: {} }));
    await assert.rejects(publish(memoryStorage(), { dir }), /Android/);
  });
});
