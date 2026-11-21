import type { AppLanguage } from "@wave/core";
import * as Effect from "effect/Effect";
import type { BridgeContract } from "../../shared/bridge.ts";
import type { LINK_CALLS } from "../../shared/links.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { Account } from "../account/accountLayer.ts";
import { DesktopLinks } from "./layer.ts";
import { isShareLink } from "./links.ts";
import { SpotifyAccount } from "../spotify/spotifyAccountLayer.ts";
import { VIDEO_ID } from "../yt/ytMusic.ts";

type Call = (typeof LINK_CALLS)[number];
type Handlers = {
  readonly [C in Call]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Account | DesktopLinks | SpotifyAccount>;
};
/** Runs [call] with the language main resolved: the window's own idea of it is never asked. */
const run = <A>(call: (links: DesktopLinks["Service"], language: AppLanguage) => Promise<A>) =>
  Effect.gen(function* () {
    const links = yield* DesktopLinks;
    const { language } = (yield* Account).language();
    return yield* Effect.tryPromise({ try: () => call(links, language), catch: (error) => error });
  });
const refuse = () => Effect.fail(new Error("Refused invalid link request"));

export const linkHandlers = (validTarget: (value: unknown) => value is SongTarget): Handlers => ({
  "links.open": ([text]) =>
    typeof text === "string" && text.length <= 16_384
      ? run((links, language) => links.open(text, language))
      : refuse(),
  "links.importPlaylist": ([token, replace]) =>
    typeof token === "string" && token.length <= 100 && typeof replace === "boolean"
      ? run((links) => links.importPlaylist(token, replace))
      : refuse(),
  "links.copySong": ([target]) =>
    validTarget(target) || (typeof target === "string" && VIDEO_ID.test(target))
      ? run((links, language) => links.copySong(target, language))
      : refuse(),
  "links.copyPlaylist": ([id]) =>
    typeof id === "number" && Number.isSafeInteger(id) && id > 0
      ? run((links, language) => links.copyPlaylist(id, language))
      : refuse(),
  "links.songShare": ([target]) =>
    validTarget(target) || (typeof target === "string" && VIDEO_ID.test(target))
      ? Effect.flatMap(SpotifyAccount, (account) =>
          run((links, language) => links.songShare(target, language, account)),
        )
      : refuse(),
  "links.copyShareLink": ([url]) =>
    isShareLink(url)
      ? run(async (links, language) => links.copyShareLink(url, language))
      : refuse(),
});
