import { formatNumber } from "../formatting.ts";
import type { CatalogueVariants } from "../localisation.ts";
import { plural } from "../plural.ts";

/**
 * The desktop's wording where the phone's text names the phone
 * (docs/spec-desktop.md, Language). Only the phrases that differ go here;
 * `desktopPtBr.ts` holds the same keys.
 */
export const desktopEn = {
  home: {
    noSections: "Your Home sections are hidden. Choose Edit Home to add them back.",
  },
  playbackText: {
    thisPhone: "This computer",
    // Recognize listens through the computer's microphone or to what the computer plays.
    holdYourPhoneNearTheMusic: "Bring the music near the microphone.",
    listeningToAudioFromThisPhone: "Listening to audio from this computer.",
    allowWaveToCaptureAudioInItsAndroidSettingsToRecognizeSongs:
      "Allow apps to use the microphone in your system's privacy settings, then try again.",
    thisAppBlocksAudioCapture: "No sound from this computer",
    tryTheMicrophoneToRecognizeMusicAroundYou:
      "Play the song on this computer, or try the microphone to recognize music around you.",
  },
  shows: {
    phoneRegion: "This computer's region",
  },
  settings: {
    openingLyricsOnASongWithLyrics:
      "Opening Lyrics on a song with lyrics shows Genius's description and highlights the fragments it annotates. Turn this off to stop all Genius requests.",
    missingSongs: {
      missing: (n: number) =>
        `${formatNumber("en", n)} ${plural("en", n, { one: "song isn't", other: "songs aren't" })} on this computer`,
    },
    // The desktop removes a saved colour with its own button and has no app icon to recolour.
    cardsGroupsSeparatorsAndTextFollowThe:
      "Cards, groups, separators and text follow the background you choose for each mode. Primary colours progress, toggles and what's active; secondary marks favorites and what's playing. Default is white in dark mode and the text colour in light. The last swatch of each takes any colour, and Save in its picker keeps up to four colours in the row; the button beside a saved colour removes it. A colour that wouldn't read on your background is deepened or brightened until it does.",
    fourColoursAreSavedToSaveThis:
      "Four colours are saved. To save this one, remove a saved colour first.",
    waveAccountNote:
      "Optional. Signed in, your song list, playlists, favorites, play history and preferences " +
      "go up to Wave's server, so your phones and this computer share them. Audio and file " +
      "paths never do.",
    waveAccountSignOutNote:
      "Signing out keeps your music files and plays on this computer. Songs from the account " +
      "with no file here leave the Library. Deleting the account deletes what Wave's server " +
      "has of it, not what's on this computer.",
    // The fresh Google sign-in opens in the browser, where the phone has Google's picker.
    deleteWaveAccount: {
      message:
        "Wave's server deletes everything it has of the account, and this computer signs out. " +
        "Nothing on this computer is deleted. Your browser then opens Google's sign-in, to " +
        "confirm it's you.",
    },
    yourWaveAccountWasDeletedEverythingOn:
      "Your Wave account was deleted. Your music files and plays on this computer stay.",
    yourWaveSessionEndedSoThisPhone:
      "Your Wave session ended, so this computer is signed out. Sign in again to keep your backup.",
    // The browser has its own Google sign-in, so there's no account to add to the system.
    addAGoogleAccountToThisPhone: "Couldn't sign in. Try again.",
    ytMusicNote:
      "Signing in is optional. Signed in, Search, playback and Home's mixes use your account. The session stays on this computer. With Download in best quality off, or when Soulseek can't deliver a song, downloads come from YouTube Music: AAC at 256 kbps with Premium, about 128 kbps without.",
    searchPlaybackAndHomesMixesUseThis:
      "Search, playback and Home's mixes use this account. Signing out forgets it on this computer.",
    signOutOnAllPhones: "Sign Out on All Devices",
    everyPhoneOnThisWaveAccountSignedOut:
      "Every device on this Wave account is signed out. Sign in again to keep your backup.",
    couldntSignOutOnAllPhonesWithoutAConnection:
      "Couldn't sign out on all devices without a connection.",
    wavesServerDidntSignOutThePhonesTry: "Wave's server didn't sign out the devices. Try again.",
    signOutEverywhere: {
      title: "Sign out on all devices?",
      message:
        "Every phone and computer signed in to this Wave account signs out, this one too. " +
        "Nothing on them is deleted. Sign in again where you use Wave.",
      action: "Sign Out on All Devices",
    },
    signInInvitation: {
      libraryTitle: "Your Library on every device",
      library:
        "Playlists, favorites, play history and preferences on your phones and this computer.",
    },
    howMuchOfAStreamedSongWave:
      "How much of a streamed song Wave loads ahead, carrying on into the next songs in Up Next, so playback keeps going through a dead zone. Longer uses more memory: about 50 MB at 30 minutes. Downloaded songs play from this computer either way.",
    waveLooksUpAPhotoOfEach:
      "Wave looks up a photo of each artist on Deezer, which means sending artist names to it, and keeps the photos on this computer. Off, artists show their album artwork and Wave makes no requests.",
  },
  recap: {
    // Home's card is clicked, not tapped.
    tapToWatch: "Click to watch",
  },
  share: {
    // Buttons under a card, in the desktop's title case.
    saveImage: "Save Image",
    copyImage: "Copy Image",
    // The lyrics card is clicked, not tapped.
    tapToChangeColour: "Click the card to change its colour",
  },
  library: {
    // The artist page's quiet lines: Online is clicked, not tapped.
    offlineTapOnline: "You're offline. Click Online to try again when you're back online.",
    noAnswerTapOnline: "No answer online. Click Online to try again.",
  },
  songDeletion: {
    // The file stays on the computer, excluded from the Library (Settings › Library includes it again).
    removeMessage: {
      one: "Its file stays on this computer. To bring it back, include it again in Settings › Library.",
      several:
        "Their files stay on this computer. To bring them back, include them again in Settings › Library.",
    },
  },
} satisfies CatalogueVariants;
