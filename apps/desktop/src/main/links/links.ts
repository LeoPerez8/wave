import { randomUUID } from "node:crypto";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  sharedTextImport,
  cantOpenNotice,
  smartLinkNotice,
  libraryFinder,
  readSpotifyAlbum,
  readSpotifyTrack,
  readDeezerTrack,
  songLinkNotice,
  songLinkNotFound,
  songSearchQuery,
  songSearchMatch,
  lookUpSongVideo,
  songLinkView,
  catalogueOf,
  librarySearchSong,
  matchSharedSongs,
  ytShareSong,
  ytShareMatch,
  syncSharedPlaylist,
  ytMusicPlaylistUrl,
  ytPrivacyChange,
  sharedEditBatches,
  readYtPlaylist,
  readSpotifyPlaylist,
  planLinkImport,
  linkImportView,
  startPlaylistImport,
  finishPlaylistImport,
  keepBothName,
  importNameClash,
  spotifyShortLinkTarget,
  desktopSongShareMenu,
  spotifyRecordingLink,
  joinArtists,
  opensOnDesktop,
  type SongLinksState,
  type SpotifySong,
  type SpotifyTrackState,
  type LinkImportPlan,
  type LinkReadFailure,
  type LinkedSource,
  type ReadPlaylist,
  type PlaylistLink,
  type AppLanguage,
  type YtAlbumSong,
  type SongSearchKey,
} from "@wave/core";
import { trackQuery, selectSongWithVideo, selectVideoIds } from "@wave/client/db/tracks";
import { tracks } from "@wave/client/db/schema";
import { eq } from "drizzle-orm";
import { songLinkEnding } from "@wave/client/songLinkEnding";
import { smartLinkEnding } from "@wave/client/smartLinkEnding";
import { spotifyTransport, deezerTransport, followShortLink } from "@wave/client/serviceTransport";
import {
  createPlaylist,
  selectPlaylist,
  selectPlaylists,
  replacePlaylistSongs,
} from "@wave/client/db/playlists";
import type { KotlinMethods } from "../kotlin/protocol.ts";
import { ytSongs } from "../yt/ytMusic.ts";
import { albums as searchedAlbums } from "../yt/ytPages.ts";
import type { OpenLinkResult, CopyLinkResult, SongShareView } from "../../shared/links.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { preference, savePreference } from "../preferences.ts";
import { isCollaborative } from "../library/collaborativePlaylists.ts";
import { targetSongs } from "../library/songActions.ts";
import { findSpotifyRecording, shareLibraryPlaylist } from "../spotify/playlistShare.ts";
import type { SpotifyAccountService } from "../spotify/spotifyAccount.ts";

export interface LinksOptions {
  readonly db: LibraryDatabase;
  readonly enabled: () => boolean;
  readonly online: () => boolean;
  readonly call: <M extends keyof KotlinMethods>(
    method: M,
    params: KotlinMethods[M]["params"],
  ) => Promise<KotlinMethods[M]["result"]>;
  readonly start: (song: { readonly id: number } | YtAlbumSong) => Promise<void>;
  /** Keeps what Wave learnt about a streamed song after it started (its album). */
  readonly remember?: (song: YtAlbumSong) => void;
  readonly writeClipboard: (text: string) => void;
  readonly changed: () => void;
  readonly fetch?: typeof globalThis.fetch;
  /** The streamed song a page or the queue brought, by its video id (Share's card and links). */
  readonly song?: (videoId: string) => YtAlbumSong | undefined;
}

/** The addresses Share's link items copy: song.link's, YT Music's and Spotify's song pages. */
const SHARE_LINKS = [
  /^https:\/\/song\.link\/y\/[A-Za-z0-9_-]{11}$/u,
  /^https:\/\/music\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/u,
  /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{1,64}$/u,
];

/** Whether [url] is a song address Share copies. */
export const isShareLink = (url: unknown): url is string =>
  typeof url === "string" && SHARE_LINKS.some((pattern) => pattern.test(url));

export const createDesktopLinks = (options: LinksOptions) => {
  /**
   * A linked song's radio names no album for it, so the player bar had no album line. Its album
   * is the one a search for the song gives its video, or the same recording under another video.
   */
  const findAlbum = async (song: YtAlbumSong): Promise<void> => {
    try {
      const page = (await options.call("search", {
        query: songSearchQuery(song as SongSearchKey),
      })) as { songs?: unknown };
      const found = ytSongs(page.songs).filter((candidate) => candidate.album);
      const match =
        found.find((candidate) => candidate.videoId === song.videoId) ??
        found.find(
          (candidate) => candidate.videoId === songSearchMatch(song as SongSearchKey, found),
        );
      if (match === undefined) return;
      options.remember?.({
        ...song,
        album: match.album,
        albumId: match.albumId,
        artworkUrl: song.artworkUrl ?? match.artworkUrl,
      });
      options.changed();
    } catch {
      // The song plays without its album line.
    }
  };
  let pending: { token: string; plan: LinkImportPlan<YtAlbumSong> } | undefined;
  const unread = (reason: LinkReadFailure, language: AppLanguage): OpenLinkResult => ({
    kind: "playlist",
    token: "",
    view: linkImportView({ status: "failed", reason }, language),
  });
  /** The import card for [link], read; a playlist that can't be read shows the phone's line for why. */
  const preview = async (link: PlaylistLink, language: AppLanguage): Promise<OpenLinkResult> => {
    const signal = AbortSignal.timeout(
      link.service === "ytMusic" && link.playlistId === "LM" ? 120_000 : 20_000,
    );
    if (link.service === "spotifyShort") {
      try {
        const landed = await followShortLink(link.url, { body: true }, signal, options.fetch);
        const target = spotifyShortLinkTarget(landed.url, landed.body);
        if (!target.ok) return unread(target.problem === "song" ? "song" : "notPlaylist", language);
        return await preview(target.link, language);
      } catch {
        return unread("unreachable", language);
      }
    }
    let source: LinkedSource<YtAlbumSong>;
    let read: ReadPlaylist;
    if (link.service === "spotify") {
      const answer = await readSpotifyPlaylist(
        link.playlistId,
        spotifyTransport(signal, options.fetch),
        signal,
      ).catch(() => ({ ok: false, reason: "unreachable" }) as const);
      if (!answer.ok)
        return unread(answer.reason === "failed" ? "spotifyFailed" : answer.reason, language);
      read = answer.playlist;
      source = { service: "spotify", playlist: answer.playlist } as LinkedSource<YtAlbumSong>;
    } else {
      try {
        const playlist = await readYtPlaylist(
          async () => {
            const page = (await options.call("playlist", {
              playlistId: link.playlistId,
            })) as Record<string, unknown>;
            if (typeof page["title"] !== "string") throw new Error("No playlist title");
            return {
              title: page["title"],
              author: null,
              artworkUrl: typeof page["artworkUrl"] === "string" ? page["artworkUrl"] : null,
              songs: ytSongs(page["songs"]),
              continuation: typeof page["continuation"] === "string" ? page["continuation"] : null,
            };
          },
          async (continuation) => {
            const page = (await options.call("playlistMore", { continuation })) as Record<
              string,
              unknown
            >;
            return {
              songs: ytSongs(page["songs"]),
              continuation: typeof page["continuation"] === "string" ? page["continuation"] : null,
            };
          },
          // Liked Songs is read to its last song, as the phone reads it.
          { signal, uncapped: link.playlistId === "LM" },
        );
        read = playlist;
        source = { service: "ytMusic", playlist };
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        return unread(
          code === "ERR_YT_OFFLINE" || !options.online() ? "offline" : "failed",
          language,
        );
      }
    }
    const plan = planLinkImport(source, trackQuery(options.db, "files").all());
    pending = { token: randomUUID(), plan };
    return {
      kind: "playlist",
      token: pending.token,
      view: linkImportView({ status: "read", playlist: read, plan }, language),
    };
  };
  /** [target]'s one Library song, or undefined when it isn't one song. */
  const librarySong = (target: SongTarget) => {
    const ids = targetSongs(options.db, target);
    return ids.length === 1
      ? trackQuery(options.db).where(eq(tracks.id, ids[0]!)).get()
      : undefined;
  };
  /** One YouTube Music search for [song]'s video, as Copy Link searches. */
  const searchVideo = async (song: SpotifySong) => {
    if (!options.online()) return { ok: false, reason: "offline" } as const;
    try {
      const page = (await options.call("search", {
        query: songSearchQuery(song as SongSearchKey),
      })) as { songs?: unknown };
      return { ok: true, songs: ytSongs(page.songs) } as const;
    } catch {
      return { ok: false, reason: "failed" } as const;
    }
  };
  /** [song]'s Spotify link, searched for as the signed-in [account]; nothing is sent signed out. */
  const spotifyLink = async (
    song: SpotifySong,
    account: Pick<SpotifyAccountService, "session" | "request">,
  ): Promise<SpotifyTrackState> =>
    account.session().status !== "signedIn"
      ? { status: "signedOut" }
      : spotifyRecordingLink(await findSpotifyRecording(account.request, song));
  return {
    /**
     * Share's submenu for a Library song ([target]) or a streamed one (its video id): the
     * song's card, and its Copy Link, Spotify and YT Music addresses as the phone's share sheet
     * finds them. Without a connection the links read Offline; with YT Music off there are none.
     */
    songShare: async (
      target: SongTarget | string,
      language: AppLanguage,
      account: Pick<SpotifyAccountService, "session" | "request">,
    ): Promise<SongShareView> => {
      const strings = catalogueOf(language, "desktop");
      let card: Omit<SongShareView, "items">;
      let videoId: string | null;
      let search: SpotifySong;
      if (typeof target === "string") {
        const song = options.song?.(target);
        if (song === undefined) throw new Error("[yt-unknown] That song isn't known anymore");
        videoId = song.videoId;
        search = {
          title: song.title,
          artists: song.artists,
          album: song.album,
          durationMs: song.durationMs,
        };
        card = {
          title: song.title,
          artist: joinArtists(song.artists),
          cover: song.artworkUrl ? { kind: "url", url: song.artworkUrl } : null,
        };
      } else {
        const song = librarySong(target);
        if (song === undefined) throw new Error("Share takes one song");
        videoId = selectVideoIds(options.db, [song.id]).get(song.id) ?? null;
        search = librarySearchSong(song);
        card = { title: song.title, artist: song.artist, cover: { kind: "song", id: song.id } };
      }
      let links: SongLinksState | null = null;
      if (options.enabled())
        links = !options.online()
          ? { video: { status: "offline" }, spotify: { status: "offline" } }
          : await Promise.all([
              lookUpSongVideo({ videoId, search }, searchVideo).catch(
                () => ({ status: "failed" }) as const,
              ),
              spotifyLink(search, account).catch(() => ({ status: "failed" }) as const),
            ]).then(([video, spotify]) => ({ video, spotify }));
      return { ...card, items: desktopSongShareMenu(links, strings) };
    },
    /** Puts one of Share's song addresses on the clipboard; anything else is refused. */
    copyShareLink: (url: string, language: AppLanguage): CopyLinkResult => {
      if (!isShareLink(url)) throw new Error("Refused a link Share doesn't give");
      options.writeClipboard(url);
      return { kind: "copied", message: catalogueOf(language, "desktop").share.linkCopied };
    },
    /** Share to Spotify: [account] asks Spotify, and the playlist's link goes to the clipboard. */
    shareToSpotify: (id: number, account: Pick<SpotifyAccountService, "session" | "request">) =>
      shareLibraryPlaylist({ db: options.db, account, writeClipboard: options.writeClipboard }, id),
    copyPlaylist: async (id: number, language: AppLanguage): Promise<CopyLinkResult> => {
      const strings = catalogueOf(language, "desktop");
      const fail = (message: string): CopyLinkResult => ({
        kind: "notice",
        notice: { title: strings.share.copyLink, message },
      });
      if (!options.enabled())
        return { kind: "notice", notice: songLinkNotice("disabled", language) };
      if (!options.online()) return fail(strings.share.failures.offline());
      const playlist = selectPlaylist(options.db, id);
      if (playlist === null) return fail(strings.playlists.deleted);
      const videoIds = selectVideoIds(
        options.db,
        playlist.items.flatMap((item) => (item.source === "library" ? [item.track.id] : [])),
      );
      try {
        const matched = await matchSharedSongs(
          playlist.items.map((item) =>
            ytShareSong(
              item.source === "library"
                ? {
                    source: "library",
                    trackId: item.track.id,
                    videoId: videoIds.get(item.track.id) ?? null,
                    matched: null,
                    song: librarySearchSong(item.track),
                  }
                : item,
            ),
          ),
          async (song) => {
            const page = (await options.call("search", {
              query: songSearchQuery(song as SongSearchKey),
            })) as { songs?: unknown };
            return ytShareMatch(song, ytSongs(page.songs));
          },
        );
        if (matched.ids.length === 0) return fail(strings.share.nothingFound.ytMusic);
        const key = `share.ytMusic.${id}`;
        const edit = async (
          playlistId: string,
          edits: readonly Record<string, string | null>[],
        ) => {
          for (const batch of sharedEditBatches(edits))
            await options.call("editPlaylist", { playlistId, edits: batch });
        };
        let privacy: string | null = null;
        const shared = await syncSharedPlaylist(
          {
            recall: async () => preference(options.db, key) ?? null,
            remember: async (value) => savePreference(options.db, key, value),
            read: async (playlistId) => {
              const read = await options.call("ownPlaylist", { playlistId });
              privacy = read?.privacy ?? null;
              return (
                read?.entries.map((entry) => ({ id: entry.videoId, entryId: entry.setVideoId })) ??
                null
              );
            },
            change: async (playlistId, { name, removes, adds }) => {
              const visibility = ytPrivacyChange("share", privacy);
              await edit(playlistId, [
                { kind: "rename", title: name },
                ...(visibility === null ? [] : [{ kind: "privacy", privacy: visibility }]),
                ...removes.map((entry) => ({
                  kind: "remove",
                  videoId: entry.id,
                  setVideoId: entry.entryId,
                })),
                ...adds.map((videoId) => ({ kind: "add", videoId })),
              ]);
            },
            move: (playlistId, moves) =>
              edit(
                playlistId,
                moves.map((move) => ({
                  kind: "move",
                  setVideoId: move.entryId,
                  before: move.before,
                })),
              ),
            create: async (title, ids) => {
              const [first = [], ...rest] = sharedEditBatches(ids);
              const playlistId = await options.call("createPlaylist", {
                title,
                videoIds: first,
                privacy: "UNLISTED",
              });
              await edit(
                playlistId,
                rest.flat().map((videoId) => ({ kind: "add", videoId })),
              );
              return playlistId;
            },
          },
          playlist.playlist.name,
          matched.ids,
        );
        options.writeClipboard(ytMusicPlaylistUrl(shared));
        return {
          kind: "copied",
          message: `${strings.share.linkCopied} · ${strings.share.found(matched.found, matched.total)}`,
        };
      } catch (error) {
        const code = (error as { code?: string }).code;
        return fail(
          code === "ERR_YT_SIGNED_OUT"
            ? strings.share.signInTitle("YouTube Music")
            : strings.share.failures.failed("YouTube Music"),
        );
      }
    },
    importPlaylist: async (token: string, replace: boolean) => {
      if (pending?.token !== token) throw new Error("No playlist import to save");
      const { plan } = pending;
      const playlists = selectPlaylists(options.db);
      const found = importNameClash(plan.name, playlists);
      // A collaborative playlist is never replaced: the import keeps both.
      const clash =
        found === undefined || isCollaborative(options.db, found.id) ? undefined : found;
      const name =
        (replace && clash !== undefined) || found === undefined
          ? plan.name
          : keepBothName(
              plan.name,
              playlists.map((p) => p.name),
            );
      const songs = finishPlaylistImport(startPlaylistImport(plan, { playlistId: 0, name })).songs;
      const saved =
        replace && clash !== undefined
          ? (() => {
              replacePlaylistSongs(options.db, clash.id, songs, Date.now());
              return { playlistId: clash.id, name };
            })()
          : createPlaylist(options.db, name, songs, Date.now());
      pending = undefined;
      options.changed();
      return { playlistId: saved.playlistId, name: saved.name };
    },
    copySong: async (
      target: SongTarget | string,
      language: "en" | "pt-BR",
    ): Promise<CopyLinkResult> => {
      const strings = catalogueOf(language, "desktop");
      if (!options.enabled())
        return { kind: "notice", notice: songLinkNotice("disabled", language) };
      let videoId: string | null = typeof target === "string" ? target : null;
      let search = null;
      if (typeof target !== "string") {
        const song = librarySong(target);
        if (song !== undefined) {
          videoId = selectVideoIds(options.db, [song.id]).get(song.id) ?? null;
          search = librarySearchSong(song);
        }
      }
      const video = await lookUpSongVideo({ videoId, search }, searchVideo);
      const link = songLinkView("copyLink", { video, spotify: { status: "signedOut" } }, strings);
      if (link.url === null)
        return {
          kind: "notice",
          notice: {
            title: strings.share.copyLink,
            message: link.note ?? strings.share.linkNotes.failed,
          },
        };
      options.writeClipboard(link.url);
      return { kind: "copied", message: strings.share.linkCopied };
    },
    open: async (text: string, language: "en" | "pt-BR"): Promise<OpenLinkResult> => {
      let shared = sharedTextImport(text, { ytMusic: true });
      if (shared.kind === "notice") return { kind: "ignored" } as const;
      // YT Music albums and artists open only on the phone yet (#1522), so they go as before.
      if (shared.kind === "song" && !opensOnDesktop(shared.link))
        return { kind: "ignored" } as const;
      const notice = (failure: Parameters<typeof songLinkNotice>[0]): OpenLinkResult => ({
        kind: "notice",
        notice: songLinkNotice(failure, language),
      });
      if (!options.enabled()) return notice("disabled");
      if (shared.kind === "smart") {
        // A smart link opens the link its page points to, as if that had been pasted.
        if (!options.online())
          return { kind: "notice", notice: smartLinkNotice("offline", language) };
        const ending = await smartLinkEnding(
          shared.url,
          (url, body, signal) => followShortLink(url, { body }, signal, options.fetch),
          AbortSignal.timeout(20_000),
          // Of the page's links, only one the desktop opens: not a YT Music album or an artist.
          opensOnDesktop,
        );
        if (!("link" in ending))
          return { kind: "notice", notice: smartLinkNotice(ending.failure, language) };
        shared = sharedTextImport(ending.link, { ytMusic: true });
        if (
          shared.kind === "notice" ||
          shared.kind === "smart" ||
          (shared.kind === "song" && !opensOnDesktop(shared.link))
        )
          return { kind: "notice", notice: cantOpenNotice(language) };
      }
      if (!options.online())
        return notice(
          shared.kind === "song" && shared.link.service === "spotifyAlbum"
            ? "albumOffline"
            : "offline",
        );
      if (shared.kind === "import") return preview(shared.link, language);
      const songs = trackQuery(options.db, "files").all();
      const find = libraryFinder(songs);
      const ending = await songLinkEnding<YtAlbumSong, (typeof songs)[number]>(
        shared.link,
        {
          stored: async (videoId) => {
            const id = selectSongWithVideo(options.db, videoId);
            return id === null ? null : (songs.find((song) => song.id === id) ?? null);
          },
          find: async () => find,
          radio: async (videoId) => {
            try {
              const page = (await options.call("songRadio", { videoId })) as { songs?: unknown };
              return { ok: true, songs: ytSongs(page.songs) };
            } catch {
              return { ok: false, reason: options.online() ? "failed" : "offline" };
            }
          },
          search: async (song) => {
            try {
              const page = (await options.call("search", {
                query: songSearchQuery(song as SongSearchKey),
              })) as { songs?: unknown };
              const found = ytSongs(page.songs);
              const match = songSearchMatch(song as SongSearchKey, found);
              return { ok: true, songs: found.filter((candidate) => candidate.videoId === match) };
            } catch {
              return { ok: false, reason: options.online() ? "failed" : "offline" };
            }
          },
          spotify: (id, signal) => readSpotifyTrack(id, spotifyTransport(signal, options.fetch)),
          deezer: (id, signal) => readDeezerTrack(id, deezerTransport(signal, options.fetch)),
          follow: (url, body, signal) => followShortLink(url, { body }, signal, options.fetch),
          spotifyAlbum: (id, signal) =>
            readSpotifyAlbum(id, spotifyTransport(signal, options.fetch)),
          searchAlbums: async (query) => {
            try {
              return searchedAlbums(await options.call("searchAlbums", { query }));
            } catch {
              return null;
            }
          },
        },
        AbortSignal.timeout(20_000),
      );
      if ("playlist" in ending) return preview(ending.playlist, language);
      if ("album" in ending) return { kind: "album", browseId: ending.album };
      // Without the page ports an artist link ends in "Can't open this", never here.
      if ("artist" in ending) return { kind: "ignored" };
      if (ending.play === "failed") return notice(ending.failure);
      if (ending.play === "notFound")
        return {
          kind: "notFound",
          song: songLinkNotFound(ending.song, { search: true }, language),
        };
      await options.start(ending.from === "library" ? ending.track : ending.song);
      if (ending.from !== "library" && !ending.song.album) void findAlbum(ending.song);
      return { kind: "playing" };
    },
  };
};
