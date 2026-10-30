// dexdump -l xml <release.apk> | node scripts/ci/work-database.ts
// Check the compiled artifact: an unminified classpath test misses R8 removing this constructor.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Room 2.5 (via WorkManager) uses Class.newInstance() before Application.onCreate. */
export const checkWorkDatabase = (xml: string): void => {
  const classes = [...xml.matchAll(/<package\b([^>]*)>([\s\S]*?)<\/package>/g)]
    .filter(([, attributes]) => /\bname="androidx\.work\.impl"/.test(attributes!))
    .flatMap(([, , body]) => [...body!.matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/g)]);
  const implementation = classes.find(([, attributes]) =>
    /\bname="WorkDatabase_Impl"/.test(attributes!),
  );
  assert.ok(implementation, "Release APK is missing androidx.work.impl.WorkDatabase_Impl");
  const [, attributes, body] = implementation;
  assert.match(attributes!, /\bvisibility="public"/, "WorkDatabase_Impl must be public");
  assert.match(attributes!, /\babstract="false"/, "WorkDatabase_Impl must be concrete");
  const constructors = [...body!.matchAll(/<constructor\b([^>]*)>([\s\S]*?)<\/constructor>/g)];
  assert.ok(
    constructors.some(
      ([, constructorAttributes, parameters]) =>
        /\bvisibility="public"/.test(constructorAttributes!) &&
        /\bstatic="false"/.test(constructorAttributes!) &&
        !/<parameter\b/.test(parameters!),
    ),
    "Release APK is missing WorkDatabase_Impl's public no-argument constructor; Room startup will crash",
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkWorkDatabase(readFileSync(process.argv[2] ?? 0, "utf8"));
  console.log("WorkDatabase_Impl has the public no-argument constructor Room loads at startup.");
}
