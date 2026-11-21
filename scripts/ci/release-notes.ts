// The body of a GitHub Release both apps publish to (publish-release.sh). Each app writes only
// its own notes, between its markers; the phone's come first, so the body is the same whichever
// app publishes first. A body from before the markers counts as the phone's notes, which the
// phone alone used to write.
//   <current body> | node scripts/ci/release-notes.ts <android|desktop> <notes file>
//     prints the body with that app's notes in it
//   ... --unchanged   exits 0 when the body already holds those notes, 1 when it doesn't
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type ReleaseApp = "android" | "desktop";

const APPS: readonly ReleaseApp[] = ["android", "desktop"];
const HEADING: Record<ReleaseApp, string> = { android: "Android", desktop: "Desktop" };

const start = (app: ReleaseApp) => `<!-- wave-notes:${app} -->`;
const end = (app: ReleaseApp) => `<!-- /wave-notes:${app} -->`;

const normalize = (text: string) => text.replaceAll("\r\n", "\n").trim();

/** Each app's notes in a body, as that app wrote them. */
const sections = (body: string): Partial<Record<ReleaseApp, string>> => {
  const text = normalize(body);
  const found: Partial<Record<ReleaseApp, string>> = {};
  for (const app of APPS) {
    const from = text.indexOf(start(app));
    const to = text.indexOf(end(app));
    if (from !== -1 && to > from) found[app] = text.slice(from + start(app).length, to).trim();
  }
  if (Object.keys(found).length === 0 && text !== "") found.android = text;
  return found;
};

/** The body with `app`'s notes replaced by `notes`, the other app's kept as they are. */
export const releaseBody = (body: string, app: ReleaseApp, notes: string): string => {
  const found = { ...sections(body), [app]: normalize(notes) };
  const present = APPS.filter((each) => found[each] !== undefined);
  const parts = present.map((each) => {
    const section = `${start(each)}\n${found[each]}\n${end(each)}`;
    return present.length > 1 ? `# ${HEADING[each]}\n\n${section}` : section;
  });
  return `${parts.join("\n\n")}\n`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [app, file, flag] = process.argv.slice(2);
  if ((app !== "android" && app !== "desktop") || !file || (flag && flag !== "--unchanged"))
    throw new Error("Expected <android|desktop> <notes file> [--unchanged]");
  const body = readFileSync(0, "utf8");
  const merged = releaseBody(body, app, readFileSync(file, "utf8"));
  if (flag) process.exit(normalize(merged) === normalize(body) ? 0 : 1);
  process.stdout.write(merged);
}
