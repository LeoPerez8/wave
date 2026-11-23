import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accountPhotoUrl } from "./index.ts";

const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocJ1x2y3z=s96-c";

describe("accountPhotoUrl", () => {
  test("keeps the address of a photo on Google's photo host", () => {
    assert.equal(accountPhotoUrl(PHOTO), PHOTO);
    assert.equal(
      accountPhotoUrl("https://lh5.googleusercontent.com/-abc/photo.jpg"),
      "https://lh5.googleusercontent.com/-abc/photo.jpg",
    );
  });

  test("takes the host in any case", () => {
    assert.equal(
      accountPhotoUrl("https://LH3.GoogleUserContent.com/a/x"),
      "https://LH3.GoogleUserContent.com/a/x",
    );
  });

  test("gives none for anything but text, or empty text", () => {
    assert.equal(accountPhotoUrl(undefined), null);
    assert.equal(accountPhotoUrl(null), null);
    assert.equal(accountPhotoUrl(42), null);
    assert.equal(accountPhotoUrl({ url: PHOTO }), null);
    assert.equal(accountPhotoUrl(""), null);
  });

  test("gives none for an address that isn't https", () => {
    assert.equal(accountPhotoUrl("http://lh3.googleusercontent.com/a/x"), null);
    assert.equal(accountPhotoUrl("javascript:alert(1)//lh3.googleusercontent.com"), null);
    assert.equal(accountPhotoUrl("//lh3.googleusercontent.com/a/x"), null);
    assert.equal(accountPhotoUrl("lh3.googleusercontent.com/a/x"), null);
  });

  test("gives none for a host that isn't Google's photo host", () => {
    assert.equal(accountPhotoUrl("https://example.com/a.jpg"), null);
    assert.equal(accountPhotoUrl("https://googleusercontent.com/a/x"), null);
    assert.equal(accountPhotoUrl("https://evilgoogleusercontent.com/a/x"), null);
    assert.equal(accountPhotoUrl("https://lh3.googleusercontent.com.example.com/a/x"), null);
    assert.equal(accountPhotoUrl("https://example.com/lh3.googleusercontent.com/a"), null);
    assert.equal(accountPhotoUrl("https://example.com?.googleusercontent.com"), null);
    assert.equal(accountPhotoUrl("https://example.com#.googleusercontent.com"), null);
  });

  test("gives none for an address whose host could be read another way", () => {
    assert.equal(accountPhotoUrl("https://lh3.googleusercontent.com@example.com/a"), null);
    assert.equal(accountPhotoUrl("https://user@lh3.googleusercontent.com/a"), null);
    assert.equal(accountPhotoUrl("https://example.com\\.googleusercontent.com/a"), null);
    assert.equal(accountPhotoUrl("https://lh3.googleusercontent.com:8443/a"), null);
    assert.equal(accountPhotoUrl("https://.googleusercontent.com/a"), null);
    assert.equal(accountPhotoUrl("https://lh3..googleusercontent.com/a"), null);
  });

  test("gives none for an address with space or control characters in it", () => {
    assert.equal(accountPhotoUrl(` ${PHOTO}`), null);
    assert.equal(accountPhotoUrl(`${PHOTO} `), null);
    assert.equal(accountPhotoUrl("https://lh3.googleusercontent.com/a b"), null);
    assert.equal(accountPhotoUrl("https://lh3.googleusercontent.com/a\nb"), null);
    assert.equal(accountPhotoUrl("https://lh3.googleusercontent.com/a\u0000"), null);
  });

  test("gives none for an address past the longest one kept", () => {
    const path = "a".repeat(2048);
    assert.equal(accountPhotoUrl(`https://lh3.googleusercontent.com/${path}`), null);
  });
});
