import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

/**
 * Settings, accounts, first run, music folders, the scan banner, the
 * render-error screen and the shared chrome (#787). Settings › Developer and
 * the dev screens stay English and have no entries here.
 */
export const settingsEn = {
  /** Settings' pages, by `SettingsPage` id: their rows and headers. */
  pages: {
    library: "Library",
    appearance: "Appearance",
    layout: "Layout",
    swipeActions: "Swipe actions",
    playback: "Playback",
    history: "Listening History",
    followedArtists: "Followed Artists",
    lyricsAndTags: "Lyrics and tags",
    downloads: "Downloads",
    accounts: "Accounts",
    developer: "Developer",
  },
  /** Settings › Layout's pages, by `LayoutPage` id. */
  layoutPages: {
    home: "Home",
    library: "Library",
    playlists: "Playlists",
    tabBar: "Tab bar",
    nowPlaying: "Now Playing",
  },
  /** Settings › Appearance › Appearance, by `Appearance` id. */
  appearances: { system: "System", light: "Light", dark: "Dark" },
  /** The theme swatches' names, by swatch id (`white` is Default, the white or text-colour ink). */
  swatches: {
    white: "Default",
    fog: "Fog",
    sand: "Sand",
    sage: "Sage",
    blush: "Blush",
    lilac: "Lilac",
    paper: "Paper",
    black: "True black",
    slate: "Slate",
    graphite: "Graphite",
    navy: "Navy",
    forest: "Forest",
    plum: "Plum",
    teal: "Teal",
    blue: "Blue",
    violet: "Violet",
    green: "Green",
    rose: "Rose",
    lime: "Lime",
    ember: "Ember",
    gold: "Gold",
    coral: "Coral",
    magenta: "Magenta",
    sky: "Sky",
    lemon: "Lemon",
  },
  /** Where a music folder is, under its name. */
  /** The card before the first Wave account sign-in (`waveAccountCard`). */
  waveAccountCard: {
    title: "What goes up to Wave",
    message:
      "Signed in, your song list, playlists, favorites, play history and preferences go up to " +
      "Wave's server, and so does the Soulseek account Download in best quality made. Audio, " +
      "file paths and your YouTube sign-in never do.",
    action: "Continue",
  },
  /** Delete Account's confirmation (`confirmWaveAccountDeletion`). */
  deleteWaveAccount: {
    title: "Delete your Wave account?",
    message:
      "Wave's server deletes everything it has of the account, and this phone signs out. " +
      "Nothing on this phone is deleted.",
    action: "Delete Account",
  },
  /** Asked before new colours change the app icon (`launcherIconSwitch`). */
  launcherIcon: {
    title: "Change the app icon too?",
    dropsFromHomeScreen:
      "Wave's icon takes these colours when you leave the app, and your launcher removes it from the home screen when it changes. Add it back from the app drawer.",
    message: "Wave's icon takes these colours when you leave the app.",
    yes: "Yes",
    no: "No",
  },
  /** Import BlackPlayer Stats' summary (`summarizeBlackPlayerImport`). */
  blackPlayerImport: {
    nothingNew: "Nothing new imported",
    imported: "Imported BlackPlayer stats",
    newPlays: (n: number) =>
      `${formatNumber("en", n)} ${plural("en", n, { one: "new play", other: "new plays" })}`,
    allInHistory: "Every play in these files is in your history already",
    from: (songs: number, snapshots: number) =>
      `Of ${formatNumber("en", songs)} ${plural("en", songs, { one: "song", other: "songs" })}, from ${formatNumber("en", snapshots)} ${plural("en", snapshots, { one: "snapshot", other: "snapshots" })}`,
    notInLibrary: (n: number) =>
      `${formatNumber("en", n)} ${plural("en", n, { one: "song", other: "songs" })} not in your library`,
    notImported: (songs: number, plays: number) =>
      `${songs === 1 ? "Its" : "Their"} ${formatNumber("en", plays)} ${plural("en", plays, { one: "play wasn't", other: "plays weren't" })} imported`,
    unreadable: "Couldn't be read",
    notStats: "Not a BlackPlayer stats file",
  },
  /** Why a Spotify sign-in didn't work, by `SpotifySignInFailure`. */
  spotifySignInFailures: {
    offline: "Couldn't sign in without a connection.",
    failed: "Spotify didn't confirm the sign-in. Try again.",
    changed: "Spotify changed something. Try again after updating Wave.",
  },
  /** Settings › Wave Account's songs this phone has no file for (`missingSongsDownload`). */
  missingSongs: {
    downloadAll: "Download All",
    retryFailed: "Retry Failed",
    cancel: "Cancel",
    downloading: (saved: number, total: number) =>
      `Downloading · ${formatNumber("en", saved)} of ${formatNumber("en", total)}`,
    missing: (n: number) =>
      `${formatNumber("en", n)} ${plural("en", n, { one: "song isn't", other: "songs aren't" })} on this phone`,
    notFound: (n: number) =>
      `${formatNumber("en", n)} ${plural("en", n, { one: "song wasn't", other: "songs weren't" })} found`,
  },
  internalStorage: "Internal storage",
  sdCard: "SD card",
  hexPlaceholder: "rrggbb",
  tryAgain: "Try Again",
  moveUp: "Move up",
  moveDown: "Move down",
  done: "Done",
  back: "Back",
  couldntScanYourMusic: "Couldn't scan your music",
  tryAgainText: "Try again",
  updatingYourLibrary: "Updating your library",
  addingSongsToYourLibrary: "Adding songs to your library",
  lookingForMusic: "Looking for music",
  waveIsScanning: "Wave is scanning",
  youCanExcludeAFolderOnceThe: "You can exclude a folder once the scan finishes.",
  youCanAddAFolderOnceThe: "You can add a folder once the scan finishes.",
  couldntAddFolder: "Couldn't add the folder",
  couldntExcludeFolder: "Couldn't exclude the folder",
  alreadyInYourLibrary: "Already in your library",
  waveCantReadThisFolder: "Wave can't read this folder",
  pickItFromYourPhonesStorageOr:
    "Pick it from your phone's storage or SD card in the picker, rather than from a shortcut like Downloads or a cloud drive.",
  glass: "Glass",
  blur: "Blur",
  refraction: "Refraction",
  off: "Off",
  tint: "Tint",
  rim: "Rim",
  howTheTabBarMiniPlayerMenus:
    "How the tab bar, mini player, menus and dialogs show what's behind them. Blur softens it, refraction bends it at the edges (off leaves blur, tint and rim), tint lays the surface colour over it so text stays legible, and the rim is the bright edge. The sample shows each change; the app's glass takes it once you leave Appearance.",
  resetToDefaults: "Reset to defaults",
  sampleSong: "Sample song",
  sampleSongRow: "Sample song row",
  retryAll: "Retry All",
  clearAll: "Clear All",
  hideSongs: "Hide Songs",
  showSongs: "Show Songs",
  hideFailedSongs: "Hide failed songs",
  showFailedSongs: "Show failed songs",
  retry: "Retry",
  remove: "Remove",
  removeFromFailedDownloads: "Remove from failed downloads",
  yourYouTubeSessionEndedSoYTMusic:
    "Your YouTube session ended, so YT Music is signed out. Sign in again to use your account.",
  couldntSignInWithoutAConnection: "Couldn't sign in without a connection.",
  youtubeDidntConfirmTheSigninTryAgain: "YouTube didn't confirm the sign-in. Try again.",
  signOut: "Sign Out",
  searchPlaybackAndHomesMixesUseThis:
    "Search, playback and Home's mixes use this account. Signing out forgets it on this phone.",
  useYTMusic: "Use YT Music",
  searchAlsoFindsSongsOnYouTubeMusic:
    "Search also finds songs on YouTube Music, which means sending what you type to YouTube. Nothing from your library is sent. Off, Wave makes no YT Music requests.",
  alwaysSearchOnlineOpensAlbumsAndArtists:
    "Always search online opens albums and artists with Online selected and has Search look online as you type. Always search on Wi-Fi does so only off mobile data. Only on demand waits for Online to be tapped. Long-press the Library | Online toggle to change it there.",
  clearArtistPhotos: "Clear artist photos?",
  couldntClearArtistPhotos: "Couldn't clear artist photos",
  clear: "Clear",
  artistPhotos: "Artist photos",
  downloadArtistPhotos: "Download artist photos",
  waveLooksUpAPhotoOfEach:
    "Wave looks up a photo of each artist on Deezer, which means sending artist names to it, and keeps the photos on your phone. Off, artists show their album artwork and Wave makes no requests.",
  clearArtistPhotosText: "Clear artist photos",
  swipeLeft: "Swipe left",
  swipeRight: "Swipe right",
  removeTakesASongOutOfThe:
    "Remove takes a song out of the playlist it's in, and elsewhere asks before deleting it. A song without the chosen action, such as Download on a song already on the phone, doesn't swipe that way.",
  appearance: "Appearance",
  systemFollowsAndroidsLightOrDarkSetting:
    "System follows Android's light or dark setting. Light and Dark keep Wave in that mode whatever Android says.",
  spotifyEndedYourSessionSoWaveIs:
    "Spotify ended your session, so Wave is signed out. Sign in again to use your account.",
  signingOutForgetsThisAccountOnThis: "Signing out forgets this account on this phone.",
  alwaysSearchOnline: "Always search online",
  alwaysSearchOnWiFi: "Always search on Wi-Fi",
  onlyOnDemand: "Only on demand",
  searchOnline: "Search online",
  cancel: "Cancel",
  downloading: "Downloading",
  buffer: "Buffer",
  scanning: "Scanning…",
  soulseeksServerIsntAnsweringTryAgainLater: "Soulseek's server isn't answering. Try again later.",
  couldntMakeASoulseekAccountTryAgain: "Couldn't make a Soulseek account. Try again.",
  couldntConnectToSoulseekTryAgainWhen:
    "Couldn't connect to Soulseek. Try again when you're online.",
  couldntReadTheSettingReopenSettingsTo: "Couldn't read the setting. Reopen Settings to retry.",
  couldntTurnItOffTryAgain: "Couldn't turn it off. Try again.",
  downloadInBestQuality: "Download in best quality",
  bestQualityIsMP3320KbpsFrom:
    "Best quality is MP3 320 kbps from other people's shared music. It's slower than YouTube Music, and a song it can't find comes from YouTube Music instead. Off, downloads come from YouTube Music while YT Music is on.",
  theQuickBrownFoxJumpsOverThe: "The quick brown fox jumps over the lazy dog",
  sphinxOfBlackQuartzJudgeMyVow: "Sphinx of black quartz, judge my vow",
  sampleGlassCardOverColouredStripesDrawn:
    "Sample glass card over coloured stripes, drawn with the settings below",
  nowPlayingsBottomRowLeftToRight:
    "Now Playing's bottom row, left to right, with Queue always on the right. A slot set to None leaves the row, and the other buttons spread out.",
  resetToDefault: "Reset to Default",
  aButtonAnotherSlotHoldsSwapsPlaces: "A button another slot holds swaps places with this slot's.",
  signIn: "Sign In",
  signInAgain: "Sign In Again",
  signingIn: "Signing In…",
  lightBackground: "Light background",
  darkBackground: "Dark background",
  primary: "Primary",
  secondary: "Secondary",
  longpressToRemoveIt: "Long-press to remove it",
  customColour: "Custom colour",
  opensTheColourPicker: "Opens the colour picker",
  theme: "Theme",
  custom: "Custom",
  saved: "Saved",
  cardsGroupsSeparatorsAndTextFollowThe:
    "Cards, groups, separators and text follow the background you choose for each mode. Primary colours progress, toggles and what's active; secondary marks favorites and what's playing. Default is white in dark mode and the text colour in light. The last swatch of each takes any colour, and Save in its picker keeps up to four colours in the row; long-press a saved colour to remove it. A colour that wouldn't read on your background is deepened or brightened until it does. When new colours would change the app icon, Wave asks first; if you say yes, the icon takes them, or the icon colours closest to custom ones, once you leave Wave.",
  primaryColour: "Primary colour",
  secondaryColour: "Secondary colour",
  save: "Save",
  addsThisColourToTheSavedColours: "Adds this colour to the saved colours without applying it",
  fourColoursAreSavedToSaveThis:
    "Four colours are saved. To save this one, long-press a saved colour and remove it.",
  thisColourIsSaved: "This colour is saved.",
  hexColour: "Hex colour",
  light: "Light",
  dark: "Dark",
  enterA3Or6digitHexColour: "Enter a 3- or 6-digit hex colour.",
  hue: "Hue",
  dragTheRingForTheHueAnd:
    "Drag the ring for the hue and the square for the shade, or type a hex colour",
  fixSongsOnline: "Fix songs online",
  lyricsAndGenre: "Lyrics and genre",
  fixSongInTheMenuOfA:
    "Fix Song, in the menu of a song missing lyrics, a genre, a year, a track number or an explicit flag, looks up only what it lacks: its lyrics on LRCLIB, and its album's genre, year and track number and whether it's explicit on Deezer, which means sending them its title, artist, album and length. It writes what it finds into the file and never replaces what's there. Off, Wave makes no lookups.",
  fixSongsInTheWholeLibrary: "Fix songs in the whole Library",
  couldntSignIn: "Couldn't sign in",
  demoItemItOnlyClosesTheMenu: "Demo item. It only closes the menu.",
  sampleMenu: "Sample menu",
  showsTheLongpressDelayWhenHeldOpens: "Shows the long-press delay when held. Opens a sample menu.",
  openTheSampleMenu: "Open the sample menu",
  yourWaveSessionEndedSoThisPhone:
    "Your Wave session ended, so this phone is signed out. Sign in again to keep your backup.",
  yourWaveAccountWasDeletedEverythingOn:
    "Your Wave account was deleted. Everything on this phone stays.",
  addAGoogleAccountToThisPhone:
    "Add a Google account to this phone in Android's settings, then sign in.",
  thisGoogleAccountCantUseWavesServer: "This Google account can't use Wave's server.",
  couldntSignInTryAgain: "Couldn't sign in. Try again.",
  signInWithGoogle: "Sign In with Google",
  couldntDeleteTheAccountWithoutAConnection: "Couldn't delete the account without a connection.",
  wavesServerDidntDeleteTheAccountTry: "Wave's server didn't delete the account. Try again.",
  signingOut: "Signing Out…",
  deleting: "Deleting…",
  deleteAccount: "Delete Account",
  waveAccount: "Wave Account",
  waveAccountsArentSetUpOnThis:
    "Wave accounts aren't set up on this build, so there's nothing to sign in to.",
  touch: "Touch",
  longpressDelay: "Long-press delay",
  androidsRemoveAnimationsIsOnSoThe:
    "Android's Remove animations is on, so the sample doesn't fill.",
  showsTheBounceWhenSwipedItPlays: "Shows the bounce when swiped. It plays nothing.",
  motion: "Motion",
  bounceAmount: "Bounce amount",
  androidsRemoveAnimationsIsOnSoNothing: "Android's Remove animations is on, so nothing bounces.",
  importing: "Importing…",
  importBlackPlayerStats: "Import BlackPlayer Stats",
  addsThePlaysInBlackPlayersTrackStats:
    "Adds the plays in BlackPlayer's track stats files to your listening history. Pick every snapshot you have: comparing them dates the plays. Importing again only adds new plays.",
  musicFolders: "Music folders",
  theFoldersOnYourPhoneThatWave:
    "The folders on your phone that Wave shows songs from, and the folders inside them it ignores.",
  rescanLibrary: "Rescan library",
  wavePicksUpNewChangedAndRemoved:
    "Wave picks up new, changed and removed files each time you open it, and when you pull down in the Library.",
  geniusInsights: "Genius insights",
  openingLyricsOnASongWithLyrics:
    "Opening Lyrics on a song with lyrics shows what Genius says about it above the lyrics and highlights the lines Genius annotates, which means sending Genius the song's title and artist. Off, Wave makes no requests to Genius.",
  notInYourMusicFolders: "Not in your music folders",
  waveOnlyShowsSongsFromYourMusic:
    "Wave only shows songs from your music folders, so there's nothing to exclude here.",
  thisIsAMusicFolder: "This is a music folder",
  toStopWaveShowingItsSongsRemove:
    "To stop Wave showing its songs, remove it from your music folders instead.",
  alreadyExcluded: "Already excluded",
  couldntFixSongs: "Couldn't fix songs",
  somethingWentWrong: "Something went wrong",
  waveNotedWhatHappenedSaveLogsKeeps:
    "Wave noted what happened. Save Logs keeps it in Downloads/Wave. Send to Leo shares it with him.",
  couldntSendTheLogsTryAgain: "Couldn't send the logs. Try again.",
  saveLogs: "Save Logs",
  savedToDownloadsWave: "Saved to Downloads/Wave",
  couldntSaveTheLogs: "Couldn't save the logs",
  sendToLeo: "Send to Leo",
  waveCantSeeYourMusicYet: "Wave can't see your music yet",
  allowAccessToYourMusic: "Allow access to your music",
  allFilesAccessIsStillOffTurn:
    "All files access is still off. Turn on “Allow access to manage all files” for Wave, then come back.",
  wavePlaysTheAudioFilesOnThis:
    "Wave plays the audio files on this phone. To find them, it needs “All files access”, which you turn on in Android settings.",
  couldntOpenAndroidSettingsTryAgainOr:
    "Couldn't open Android settings. Try again, or find Wave under “All files access” in Android settings.",
  openSettings: "Open settings",
  itsSongsLeaveYourLibraryTheFiles: "Its songs leave your library. The files stay on your phone.",
  couldntRemoveTheFolder: "Couldn't remove the folder",
  loadingMusicFolders: "Loading music folders",
  waveShowsSongsFrom: "Wave shows songs from",
  addFolder: "Add folder",
  everyFolderInsideTheseIsIncludedWave:
    "Every folder inside these is included. Wave keeps at least one folder, and folders can't change while a scan runs.",
  waveIgnores: "Wave ignores",
  stopExcluding: "Stop excluding",
  couldntIncludeTheFolder: "Couldn't include the folder",
  excludeFolder: "Exclude folder",
  songsInExcludedFoldersAndTheFolders:
    "Songs in excluded folders, and the folders inside them, leave your library. The files stay on your phone.",
  followedArtists: "Followed artists",
  youArentFollowingAnyArtistsYet: "You aren't following any artists yet.",
  following: "Following",
  developerIsOn: "Developer is on",
  developerHidden: "Developer hidden",
  settings: "Settings",
  crossfade: "Crossfade",
  asASongEndsOnItsOwn:
    "As a song ends on its own, the next one fades in over it for this long. Skipping or picking a song switches at once. Off plays songs back to back, without a gap.",
  dontPlayExplicit: "Don't play explicit",
  skipsSongsMarkedExplicitByYouTubeMusic: "Skips songs marked explicit by YouTube Music or Deezer.",
  howMuchOfAStreamedSongWave:
    "How much of a streamed song Wave loads ahead, carrying on into the next songs in Up Next, so playback keeps going through a dead zone. Longer uses more memory: about 50 MB at 30 minutes. Downloaded songs play from the phone either way.",
  swipeActions: "Swipe actions",
  swipeASongSidewaysInAList:
    "Swipe a song sideways in a list to run one of its actions. Up Next doesn't swipe.",
  songRowsDontSwipeEveryActionIs:
    "Song rows don't swipe. Every action is still in a song's long-press menu.",
  keepFindFieldVisible: "Keep Find Field Visible",
  theFindFieldStaysUnderThePages:
    "The Find field stays under the page's header while the list scrolls, instead of waiting above the list until it's pulled down.",
  oneOfHomesSectionsShownUnderThe:
    "One of Home's sections, shown under the Library's rows while it has something to show.",
  everyShuffleUsesItALongPress:
    "Every shuffle uses it. A long press on a shuffle button picks it too, but in a Now Playing slot it changes the button.",
  pressBackAgainWithin2SecondsTo: "Press Back again within 2 seconds to exit",
  dismisses: "Dismisses",
  close: "Close",
  selectionActions: "Selection actions",
  more: "More",
  moreActions: "More actions",
  selectAll: "Select All",
  ytMusicNote:
    "Signing in is optional. Signed in, Search, playback and Home's mixes use your account. The session stays on this phone. With Download in best quality off, or when Soulseek can't deliver a song, downloads come from YouTube Music: AAC at 256 kbps with Premium, about 128 kbps without.",
  spotifyNote:
    "Signing in lets Wave read your Spotify playlists and share yours there. Sign in with your email and password or an emailed code: Continue with Google may not work here. The session stays on this phone, and Wave talks to Spotify the way its web player does.",
  waveAccountNote:
    "Optional. Keeps your song list, playlists, favorites, play history and preferences, so another phone signed in gets them back.",
  waveAccountSignOutNote:
    "Signing out keeps everything on this phone. Deleting the account deletes what Wave's server has of it, not what's on this phone.",
  longPressFootnote: (ms: number) =>
    `Hold the sample song to feel the delay. The default is ${formatNumber("en", ms)} ms.`,
  bounceFootnote: (percent: number) =>
    `Swipe the sample song to feel the bounce. The default is ${formatNumber("en", percent)}%.`,
  manageFollow: (name: string, level: string) => `Manage ${name}, Following, ${level}`,
  signedIn: (name: string, email: string | null) =>
    `Signed in as ${name}${email === null ? "" : `, ${email}`}`,
  spotifySignedIn: (name: string) => `Signed in to Spotify as ${name}`,
  retryLine: (line: string) => `Retry ${line}`,
  removeFailure: (line: string) => `Remove ${line} from failed downloads`,
  slot: (n: number) => `Slot ${n}`,
  swapSlot: (label: string, title: string, holder: string) =>
    `${label}, ${title}, swaps with ${holder}`,
  swipeHint: (side: "left" | "right") => `Chooses what swiping ${side} runs`,
  minutes: (n: number) =>
    `${formatNumber("en", n)} ${plural("en", n, { one: "minute", other: "minutes" })}`,
  downloadedLine: (count: string, line: string) => `${count} downloaded, ${line}`,
  colourMode: (mode: string, colour: string) => `${mode} mode: ${colour}`,
  adjustedColour: (light: boolean, dark: boolean) =>
    `Adjusted to read on your ${light && dark ? "backgrounds" : `${light ? "light" : "dark"} background`}, as shown.`,
  clearPhotos: (n: number) =>
    `The ${plural("en", n, { one: "photo", other: `${formatNumber("en", n)} photos` })} Wave downloaded will be deleted. Artists show their album artwork until photos are downloaded again.`,
  newFiles: (read: string, total: string) => `${read} of ${total} new or changed files read`,
  indexedFiles: (read: string, total: string) => `${read} of ${total} files indexed`,
  foundFiles: (n: string, count: number) =>
    `${n} ${plural("en", count, { one: "file", other: "files" })} found`,
  selected: (n: string, _count: number) => `${n} selected`,
  folderCovered: (name: string) =>
    `Wave already shows the songs in ${name}, which includes this folder.`,
  folderIgnored: (name: string) => `Wave already ignores ${name}, which includes this folder.`,
  savedColour: (n: number, hex: string) => `Saved colour ${n}, ${hex}`,
  removeFolder: (name: string) => `Remove ${name}?`,
  couldntFixSongsToast: (message: string) => `Couldn't fix songs: ${message}`,
  musicFolderCount: (n: number) =>
    `${formatNumber("en", n)} ${plural("en", n, { one: "music folder", other: "music folders" })}`,
  artistCount: (n: number) =>
    `${formatNumber("en", n)} ${plural("en", n, { one: "artist", other: "artists" })}`,
  /** A screen title's TalkBack hint when a long press opens its options ("Choose how playlists show"). */
  titleLongPressHint: (label: string) => `Long press to ${label.toLowerCase()}`,
};
