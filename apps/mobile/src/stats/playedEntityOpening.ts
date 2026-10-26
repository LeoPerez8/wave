import { pickStreamedAlbum, pickYtArtist, type YtArtistCandidate } from "@wave/core";

/** The caller includes screen settlement, visibility, consent and Android connectivity in allowed. */
export const loadPlayedArtistImage = async (
  name: string,
  gate: {
    readonly enabled: () => boolean;
    readonly settled: () => boolean;
    readonly visible: () => boolean;
    readonly online: () => boolean;
  },
  search: (name: string) => Promise<readonly YtArtistCandidate[]>,
): Promise<string | null> => {
  const allowed = () => gate.enabled() && gate.settled() && gate.visible() && gate.online();
  if (!allowed()) return null;
  const candidates = await search(name);
  if (!allowed()) return null;
  const id = pickYtArtist(name, candidates);
  return candidates.find((candidate) => candidate.browseId === id)?.artworkUrl ?? null;
};

/** A browse id opens directly; a plain album resolves only on its tap. Recheck consent after search. */
export const openPlayedRelease = async (
  album: {
    readonly title: string;
    readonly artists: readonly string[];
    readonly albumId: string | null;
  },
  enabled: () => boolean,
  search: (query: string) => Promise<
    readonly {
      readonly title: string;
      readonly artists: readonly string[];
      readonly browseId: string;
    }[]
  >,
  open: (id: string) => void,
): Promise<"off" | "missing" | "opened"> => {
  if (!enabled()) return "off";
  const id =
    album.albumId ??
    pickStreamedAlbum(album, await search(`${album.title} ${album.artists[0] ?? ""}`));
  if (!enabled()) return "off";
  if (id === null) return "missing";
  open(id);
  return "opened";
};
