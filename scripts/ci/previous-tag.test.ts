import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previousTag } from "./previous-tag.ts";

describe("previousTag", () => {
  it("is main's newest stable version tag, by version, leaving out -ti and other tags", () => {
    const tags = ["latest", "pr-12", "v0.9.0", "v0.10.0-ti", "v0.10.0", "v0.10.1-ti", "v0.2.0"];
    assert.equal(previousTag({ channel: "main", tags, own: [] }), "v0.10.0");
  });

  it("is ti's newest -ti tag, even below a newer stable one", () => {
    const tags = ["v0.5.3", "v0.5.4-ti", "v0.5.5", "v0.5.10-ti", "ti-latest"];
    assert.equal(previousTag({ channel: "ti", tags, own: [] }), "v0.5.10-ti");
  });

  it("is the newest stable tag before ti's first -ti one", () => {
    assert.equal(previousTag({ channel: "ti", tags: ["v0.5.0", "v0.5.3"], own: [] }), "v0.5.3");
  });

  it("leaves out the commit's own tag: that's the release it is", () => {
    const tags = ["v0.5.3", "v0.5.4-ti", "v0.5.5-ti", "v0.5.6"];
    assert.equal(previousTag({ channel: "main", tags, own: ["v0.5.6"] }), "v0.5.3");
    assert.equal(previousTag({ channel: "ti", tags, own: ["v0.5.5-ti"] }), "v0.5.4-ti");
  });

  it("is none when the channel has no previous release", () => {
    assert.equal(
      previousTag({ channel: "main", tags: ["v0.5.1-ti", "latest"], own: [] }),
      undefined,
    );
    assert.equal(previousTag({ channel: "ti", tags: ["v0.5.0"], own: ["v0.5.0"] }), undefined);
  });
});
