import * as Effect from "effect/Effect";
import type { BridgeContract } from "../../shared/bridge.ts";
import type { LINK_CALLS } from "../../shared/links.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { DesktopLinks } from "./layer.ts";
import { VIDEO_ID } from "../yt/ytMusic.ts";

type Call = (typeof LINK_CALLS)[number];
type Handlers = {
  readonly [C in Call]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, DesktopLinks>;
};
const language = (value: unknown): value is "en" | "pt-BR" => value === "en" || value === "pt-BR";
const run = <A>(call: (links: DesktopLinks["Service"]) => Promise<A>) =>
  Effect.gen(function* () {
    const links = yield* DesktopLinks;
    return yield* Effect.tryPromise({ try: () => call(links), catch: (error) => error });
  });
const refuse = () => Effect.fail(new Error("Refused invalid link request"));

export const linkHandlers = (validTarget: (value: unknown) => value is SongTarget): Handlers => ({
  "links.open": ([text, lang]) =>
    typeof text === "string" && text.length <= 16_384 && language(lang)
      ? run((links) => links.open(text, lang))
      : refuse(),
  "links.importPlaylist": ([token, replace]) =>
    typeof token === "string" && token.length <= 100 && typeof replace === "boolean"
      ? run((links) => links.importPlaylist(token, replace))
      : refuse(),
  "links.copySong": ([target, lang]) =>
    language(lang) && (validTarget(target) || (typeof target === "string" && VIDEO_ID.test(target)))
      ? run((links) => links.copySong(target, lang))
      : refuse(),
  "links.copyPlaylist": ([id, lang]) =>
    typeof id === "number" && Number.isSafeInteger(id) && id > 0 && language(lang)
      ? run((links) => links.copyPlaylist(id, lang))
      : refuse(),
});
