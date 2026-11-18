import assert from "node:assert/strict";
import { test } from "node:test";
import { keyringHost } from "./keyring.ts";

/** A keyring that reverses the text, so sealed bytes differ from the plain ones. */
const box = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from([...text].toReversed().join(""), "utf8"),
  decryptString: (bytes: Buffer) => [...bytes.toString("utf8")].toReversed().join(""),
});

test("the JVM's Soulseek account is sealed with the keyring and unsealed back", async () => {
  const host = keyringHost(box());
  const plain = Buffer.from("account secret").toString("base64");
  const sealed = (await host.seal!({ data: plain })) as { data: string };
  assert.notEqual(sealed.data, plain);
  assert.deepEqual(await host.unseal!(sealed), { data: plain });
});

test("without a keyring nothing is sealed", async () => {
  const host = keyringHost(box(false));
  await assert.rejects(host.seal!({ data: "AAAA" }), { code: "ERR_NO_KEYRING" });
  await assert.rejects(host.unseal!({ data: "AAAA" }), { code: "ERR_NO_KEYRING" });
});

test("on Linux, Chromium's plain-text store isn't a keyring", async () => {
  const host = keyringHost({ ...box(), getSelectedStorageBackend: () => "basic_text" }, "linux");
  await assert.rejects(host.seal!({ data: "AAAA" }), { code: "ERR_NO_KEYRING" });
});
