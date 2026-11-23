import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

// A collaborative playlist member's circle (docs/spec.md, "Collaborative playlists", What it
// shows): their Google photo, else their initial, also when the photo fails to load.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const [{ MemberCircle }] = await loadWithStubs<[typeof import("./MemberCircle.tsx")]>(
  [import.meta.resolve("./MemberCircle.tsx")],
  { ...nativeStubs(), "expo-image": stubModule(`export const Image = "expoImage";`) },
);

const PHOTO = "https://lh3.googleusercontent.com/a/ana=s96-c";
const OTHER_PHOTO = "https://lh3.googleusercontent.com/a/bo=s96-c";

type Props = Parameters<typeof MemberCircle>[0];

const drawn = (props: Props): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(MemberCircle, props));
  });
  return renderer!;
};

/** What the circle shows: the photo's address, or the initial's text. */
const shown = (renderer: ReactTestRenderer): string => {
  const photos = renderer.root.findAllByType("expoImage" as never);
  if (photos.length > 0) return (photos[0]!.props.source as { uri: string }).uri;
  return renderer.root
    .findAllByType("text" as never)
    .map((text: ReactTestInstance) => text.props.children as string)
    .join("");
};

const failToLoad = (renderer: ReactTestRenderer): void => {
  const photo = renderer.root.findByType("expoImage" as never);
  act(() => (photo.props.onError as (event: unknown) => void)({ error: "404" }));
};

test("a member with a photo shows the photo", () => {
  const renderer = drawn({ initial: "A", photoUrl: PHOTO });
  assert.equal(shown(renderer), PHOTO);
  act(() => renderer.unmount());
});

test("a member without a photo shows the initial", () => {
  for (const photoUrl of [null, undefined]) {
    const renderer = drawn({ initial: "A", photoUrl });
    assert.equal(shown(renderer), "A");
    act(() => renderer.unmount());
  }
});

test("a photo that fails to load shows the initial, and a new photo tries again", () => {
  const renderer = drawn({ initial: "A", photoUrl: PHOTO });
  failToLoad(renderer);
  assert.equal(shown(renderer), "A");

  act(() => renderer.update(createElement(MemberCircle, { initial: "A", photoUrl: PHOTO })));
  assert.equal(shown(renderer), "A", "the same address isn't tried again");

  act(() => renderer.update(createElement(MemberCircle, { initial: "A", photoUrl: OTHER_PHOTO })));
  assert.equal(shown(renderer), OTHER_PHOTO);
  act(() => renderer.unmount());
});

test("the circle is hidden from accessibility, photo or initial", () => {
  for (const photoUrl of [PHOTO, null]) {
    const renderer = drawn({ initial: "A", photoUrl, stacked: true });
    const circle = renderer.root.findAllByType("view" as never)[0]!;
    assert.equal(circle.props.accessible, false);
    assert.equal(circle.props.importantForAccessibility, "no-hide-descendants");
    act(() => renderer.unmount());
  }
});

test("a row's circle is 22dp and the Members sheet's 36dp, photo or initial", () => {
  const widthOf = (props: Props): number => {
    const renderer = drawn(props);
    const style = renderer.root.findAllByType("view" as never)[0]!.props.style as {
      width: number;
      height: number;
      borderRadius: number;
    };
    act(() => renderer.unmount());
    assert.equal(style.height, style.width);
    assert.equal(style.borderRadius, style.width / 2);
    return style.width;
  };
  for (const photoUrl of [PHOTO, null]) {
    assert.equal(widthOf({ initial: "A", photoUrl }), 22);
    assert.equal(widthOf({ initial: "A", photoUrl, size: "sheet" }), 36);
  }
});

test("the Members sheet's circle shows the photo, else the initial", () => {
  const withPhoto = drawn({ initial: "A", photoUrl: PHOTO, size: "sheet" });
  assert.equal(shown(withPhoto), PHOTO);
  failToLoad(withPhoto);
  assert.equal(shown(withPhoto), "A");
  act(() => withPhoto.unmount());
});

test("a stacked circle overlaps the one before it; one alone doesn't", () => {
  const marginOf = (stacked: boolean): number => {
    const renderer = drawn({ initial: "A", photoUrl: null, stacked });
    const style = renderer.root.findAllByType("view" as never)[0]!.props.style as {
      marginLeft: number;
    };
    act(() => renderer.unmount());
    return style.marginLeft;
  };
  assert.ok(marginOf(true) < 0);
  assert.equal(marginOf(false), 0);
});
