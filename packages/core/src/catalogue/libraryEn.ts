import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

const n = (count: number): string => formatNumber("en", count);

/** The kinds of Library list that read on their own (`LibraryReadFeedback`). */
type ReadList =
  | "songs"
  | "favorites"
  | "playlists"
  | "artists"
  | "genres"
  | "albums"
  | "songOrder"
  | "songMatches";

/** The Library's detail pages (`DetailFrame`). */
type DetailNoun = "album" | "artist" | "genre" | "playlist";

/** The Library tab, its lists and detail pages, Find, sort menus and selection mode. */
export const libraryEn = {
  /** Under each Library row's list when it has nothing in it. */
  sectionEmpty: {
    playlists: "Make a playlist, then add songs, albums or artists to it from their menus.",
    artists: "Artists appear once Wave has scanned your music.",
    albums: "Albums appear once Wave has scanned your music.",
    songs: "Songs appear once Wave has scanned your music.",
    genres: "Genres appear once Wave has scanned your music.",
    favorites: "Star a song from its menu or from Now Playing to keep it here.",
  },
  noMusicFound: "No music found",
  noAudioIn: (folders: string): string =>
    `Wave didn't find any audio files in ${folders}. Choose the folder your music is in.`,
  chooseMusicFolder: "Choose music folder",
  /** The scan roots in a sentence: "your Músicas folder", "your 3 music folders". */
  oneFolder: (name: string): string => `your ${name} folder`,
  folders: (count: number): string =>
    count === 0 ? "your music folders" : `your ${n(count)} music folders`,
  lookingForMusic: "Looking for music",
  nothingHereYet: "Nothing here yet",
  noSuchSection: "This part of the library doesn't exist.",
  lookingForSongs: "Looking for songs",
  noSongs: "No songs",
  songsAppearAsFound: "Songs appear here as Wave finds them.",
  noSongsIn: (folders: string): string => `Wave didn't find any songs in ${folders}.`,
  noFavorites: "No favorites yet",
  loadingList: {
    songs: "Loading songs",
    favorites: "Loading favorites",
    playlists: "Loading playlists",
    artists: "Loading artists",
    genres: "Loading genres",
    albums: "Loading albums",
    songOrder: "Loading song order",
    songMatches: "Loading song matches",
  } satisfies Record<ReadList, string>,
  couldntLoadList: {
    songs: "Couldn't load songs. Try again.",
    favorites: "Couldn't load favorites. Try again.",
    playlists: "Couldn't load playlists. Try again.",
    artists: "Couldn't load artists. Try again.",
    genres: "Couldn't load genres. Try again.",
    albums: "Couldn't load albums. Try again.",
    songOrder: "Couldn't load song order. Try again.",
    songMatches: "Couldn't load song matches. Try again.",
  } satisfies Record<ReadList, string>,
  tryAgain: "Try Again",
  searching: "Searching…",
  reading: "Reading…",
  loading: "Loading…",
  loadingSongs: "Loading songs",
  loadingDetail: {
    album: "Loading album",
    artist: "Loading artist",
    genre: "Loading genre",
    playlist: "Loading playlist",
  } satisfies Record<DetailNoun, string>,
  gone: {
    album: "This album is gone",
    artist: "This artist is gone",
    genre: "This genre is gone",
    playlist: "This playlist is gone",
  } satisfies Record<DetailNoun, string>,
  filesGone: "Its files are no longer in your music folders.",
  play: "Play",
  /** Counts on a list's opening line ("12 songs", "3 albums", "52 min"). */
  songCount: (count: number): string =>
    plural("en", count, { one: `${n(count)} song`, other: `${n(count)} songs` }),
  albumCount: (count: number): string =>
    plural("en", count, { one: `${n(count)} album`, other: `${n(count)} albums` }),
  minutes: (count: number): string => `${n(count)} min`,
  disc: (disc: number): string => `Disc ${n(disc)}`,
  goTo: (name: string): string => `Go to ${name}`,
  goToArtist: "Go to Artist",
  albums: "Albums",
  singlesAndEps: "Singles & EPs",
  appearsOn: "Appears on",
  popular: "Popular",
  songs: "Songs",
  loadingAlbums: "Loading albums",
  album: "Album",
  single: "Single",
  albumYear: (year: number): string => `Album · ${year}`,
  /** A card's or row's TalkBack label and second line. */
  artistLabel: (name: string): string => `${name}, artist`,
  albumLabel: (title: string, artist: string): string => `${title}, album by ${artist}`,
  songLabel: (title: string, artist: string): string => `${title}, song by ${artist}`,
  coverLabel: (title: string, byline: string, detail: string): string =>
    `${title} by ${byline}, ${detail}`,
  playlistLabel: (name: string, detail: string): string => `${name}, playlist, ${detail}`,
  artistRow: "Artist",
  albumRow: (artist: string): string => `Album · ${artist}`,
  songRow: (artist: string): string => `Song · ${artist}`,
  playlistRow: (detail: string): string => `Playlist · ${detail}`,
  /** A song row's states, read out after its title and line. */
  row: {
    loadingSong: "Loading song",
    song: "Song",
    fileNotFound: "File not found",
    explicit: "explicit",
    downloaded: "downloaded",
    notDownloaded: "not downloaded",
    unavailable: "unavailable",
    nowPlaying: "now playing",
  },
  alphabetIndex: "Alphabet index",
  alphabetHint: "Swipe up or down to jump to a letter",
  /** Selection mode's header and bar. */
  selected: (count: number): string => `${n(count)} selected`,
  /** Counts of a kind ("3 albums"): list heads, and selection mode when it isn't songs. */
  kindCounts: {
    album: (count: number): string =>
      plural("en", count, { one: `${n(count)} album`, other: `${n(count)} albums` }),
    artist: (count: number): string =>
      plural("en", count, { one: `${n(count)} artist`, other: `${n(count)} artists` }),
    playlist: (count: number): string =>
      plural("en", count, { one: `${n(count)} playlist`, other: `${n(count)} playlists` }),
    genre: (count: number): string =>
      plural("en", count, { one: `${n(count)} genre`, other: `${n(count)} genres` }),
    section: (count: number): string =>
      plural("en", count, { one: `${n(count)} section`, other: `${n(count)} sections` }),
  },
  selectAll: "Select All",
  done: "Done",
  selectionActions: "Selection actions",
  more: "More",
  moreActions: "More actions",
  sortBy: "Sort by",
  sortButton: (sort: string): string => `Sort, ${sort}`,
  /** Song sorts: a name, then its direction ("Artist, Z to A"). */
  songSorts: {
    title: "Song name",
    artist: "Artist",
    album: "Album",
    added: "Date added",
    starred: "Date starred",
    popular: "Popular",
  },
  sortDirections: {
    aToZ: "A to Z",
    zToA: "Z to A",
    oldestFirst: "oldest first",
    newestFirst: "newest first",
  },
  sortLabel: (name: string, direction: string): string => `${name}, ${direction}`,
  /** Find's field, and what it says when nothing matches. */
  find: {
    playlist: "Find in Playlist",
    songs: "Find in Songs",
    artists: "Find in Artists",
    albums: "Find in Albums",
    genres: "Find in Genres",
    playlists: "Find in Playlists",
  },
  noMatch: {
    playlist: "No songs match",
    songs: "No songs match",
    artists: "No artists match",
    albums: "No albums match",
    genres: "No genres match",
    playlists: "No playlists match",
  },
  /** The Library's shelf, picked from its title's long press. */
  shelfUnderLibrary: "Shelf under the Library",
  chooseShelf: "Choose the Library's shelf",
  noShelf: "None",
  /** Following an artist from their page. */
  follow: "Follow",
  following: "Following",
  followArtist: (name: string): string => `Follow ${name}`,
  /** The follow button's TalkBack label: the artist, then Follow or Following and its level. */
  followState: (name: string, level: string | null): string =>
    level === null ? `${name}, Follow` : `${name}, Following, ${level}`,
  unfollow: "Unfollow",
  couldntFollow: "Couldn't follow artist",
  couldntUnfollow: "Couldn't unfollow artist",
  couldntOpenArtist: "Couldn't open the artist",
  ytMusicTurnedOff: "YouTube Music is turned off.",
  ytMusicOffInSettings: "YT Music is off in Settings",
  couldntReadArtists: "Couldn't read the artists",
  /** An artist page's Library | Online toggle, and what Online finds. */
  library: "Library",
  online: "Online",
  libraryHint: "Shows only what's in your library",
  onlineHint: "Adds what YouTube Music has",
  searchOnline: "Search online",
  longPressOnline: (hint: string): string => `${hint}. Long press to choose when to search online`,
  allInLibrary: "Your library already has every song of this artist.",
  noSongsOnline: "No songs online for this artist.",
  notFoundOnline: "Not found online.",
  offlineTapOnline: "You're offline. Tap Online to try again when you're back online.",
  noAnswerTapOnline: "No answer online. Tap Online to try again.",
  ytArtistOff: "YT Music is off. Turn it on in Settings to see this artist.",
  albumsNeedNetwork: "You're offline. YT Music albums need the network.",
  noAnswerTryLater: "No answer online. Try again in a moment.",
  offline: "You're offline",
  noAnswer: "No answer online",
  songsNeedNetwork: "These songs need the network.",
  songsCouldntLoad: "The songs couldn't be loaded. Try again.",
  /** A YT Music playlist whose later pages didn't load (`ytPlaylistRestLine`). */
  ytPlaylistRestOffline: "You're offline, so the rest of this playlist didn't load.",
  ytPlaylistRestFailed:
    "The rest of this playlist didn't load. Go back and open it again to try once more.",
  /** What a YT Music list page is, before its count and length ("Album · 2013"). */
  pageKind: {
    album: "Album",
    albumOf: (year: number): string => `Album · ${year}`,
    playlist: "Playlist",
    mix: "Mix",
  },
  /** The explicit badge on a song's row. */
  explicitBadge: "E",
  /** Unavailable entries: their row's line, what a tap says, their menu, and Try Again. */
  unavailable: {
    notFound: "Not found online",
    localFile: "Local file on Spotify",
    notFoundNotice: "Wave couldn't find this song online or in your Library.",
    localFileNotice: "This song is a local file on Spotify, so Wave couldn't look for it.",
    allNotFound: "Wave couldn't find these songs online or in your Library.",
    allLocalFiles: "These songs are local files on Spotify, so Wave couldn't look for them.",
    allMixed:
      "Wave couldn't find these songs online or in your Library, or they're local files on Spotify.",
    removeFromPlaylist: "Remove from Playlist",
    search: "Search",
    found: (found: number, searched: number): string => `Found ${n(found)} of ${n(searched)}`,
    searchesFailed: (count: number): string =>
      plural("en", count, {
        one: `${n(count)} search failed`,
        other: `${n(count)} searches failed`,
      }),
    couldntSave: "Couldn't save what Try Again found",
  },
  couldntRemoveSong: "Couldn't remove the song",
  /** The photo cropper (Change Image, Adjust Image). */
  cancel: "Cancel",
  moveAndScale: "Move and Scale",
  photoFraming: "Photo framing",
  photoFramingHint: "Drag to move or pinch to zoom. Actions also move, zoom and reset the photo.",
  framingValue: (zoom: number, across: number, down: number): string =>
    `${zoom.toFixed(2)} times zoom, centre ${across} percent across, ${down} percent down`,
  movePhotoLeft: "Move photo left",
  movePhotoRight: "Move photo right",
  movePhotoUp: "Move photo up",
  movePhotoDown: "Move photo down",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  resetFraming: "Reset framing",
};
