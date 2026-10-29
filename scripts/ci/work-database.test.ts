import assert from "node:assert/strict";
import { test } from "node:test";

import { checkWorkDatabase } from "./work-database.ts";

// The shape of SDK dexdump's XML, minimised from the crashing 0.38.0-ti APK.
const dex = (members: string, attributes = 'abstract="false" visibility="public"') => `
<api><package name="androidx.work.impl">
<class name="WorkDatabase" abstract="true" visibility="public"></class>
<class name="WorkDatabase_Impl" ${attributes}>${members}</class>
</package></api>`;
const constructor = (attributes: string, parameters = "") =>
  `<constructor name="WorkDatabase_Impl" ${attributes}>${parameters}</constructor>`;
const publicConstructor = 'visibility="public" static="false"';

test("rejects the release crash: the implementation survives R8 but its constructor does not", () => {
  assert.throws(
    () => checkWorkDatabase(dex('<method name="c"></method>')),
    /no-argument constructor/,
  );
});

test("accepts the public no-argument constructor, including in a later dex", () => {
  checkWorkDatabase(
    '<api><package name="other"></package></api>' + dex(constructor(publicConstructor)),
  );
});

test("rejects a renamed or removed implementation", () => {
  assert.throws(
    () => checkWorkDatabase(dex("").replace("WorkDatabase_Impl", "a")),
    /missing androidx/,
  );
});

test("a constructor with parameters, an inaccessible one or a static initializer is insufficient", () => {
  for (const member of [
    constructor(publicConstructor, '<parameter name="arg0" type="int"></parameter>'),
    constructor('visibility="private" static="false"'),
    constructor('visibility="public" static="true"'),
  ])
    assert.throws(() => checkWorkDatabase(dex(member)), /no-argument constructor/);
});

test("rejects an abstract or inaccessible implementation", () => {
  for (const attributes of [
    'abstract="true" visibility="public"',
    'abstract="false" visibility="package"',
  ])
    assert.throws(() => checkWorkDatabase(dex(constructor(publicConstructor), attributes)));
});
