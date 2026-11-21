import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchCover } from "./cover.ts";

const answering =
  (body: Uint8Array<ArrayBuffer>, type: string, status = 200) =>
  async () =>
    new Response(body, { status, headers: { "content-type": type } });

test("a cover is an https image, handed to the window as a data URL", async () => {
  assert.equal(
    await fetchCover(
      "https://is1.example/cover.jpg",
      answering(new Uint8Array([1, 2]), "image/jpeg"),
    ),
    "data:image/jpeg;base64,AQI=",
  );
});

test("anything else isn't shown", async () => {
  const image = answering(new Uint8Array([1]), "image/png");
  assert.equal(await fetchCover("http://is1.example/cover.png", image), null);
  assert.equal(await fetchCover("https://x/a", answering(new Uint8Array([1]), "text/html")), null);
  assert.equal(
    await fetchCover("https://x/a", answering(new Uint8Array([1]), "image/png", 404)),
    null,
  );
  assert.equal(
    await fetchCover("https://x/a", answering(new Uint8Array(3 * 1024 * 1024), "image/png")),
    null,
  );
  assert.equal(
    await fetchCover("https://x/a", async () => {
      throw new Error("offline");
    }),
    null,
  );
});
