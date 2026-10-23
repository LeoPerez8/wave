import type { StreamedArtistLink } from "@wave/core";

/** Shared gesture action for Now Playing, Go to Artist menus and swipes. */
export const followStreamedArtistTap = async <A>(
  link: StreamedArtistLink<A>,
  options: {
    readonly resolve: (link: StreamedArtistLink<A>) => Promise<StreamedArtistLink<A> | undefined>;
    readonly deliver: (link: StreamedArtistLink<A> | undefined) => void;
  },
): Promise<void> => {
  const targets = link.kind === "open" ? [link.target] : link.kind === "choose" ? link.targets : [];
  options.deliver(
    targets.some((target) => target.kind === "unread") ? await options.resolve(link) : link,
  );
};
