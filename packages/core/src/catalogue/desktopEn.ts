import type { CatalogueVariants } from "../localisation.ts";

/**
 * The desktop's wording where the phone's text names the phone
 * (docs/spec-desktop.md, Language). Only the phrases that differ go here;
 * `desktopPtBr.ts` holds the same keys.
 */
export const desktopEn = {
  home: {
    noSections: "Your Home sections are hidden. Arrange Home on your phone to add them back.",
  },
  playbackText: {
    thisPhone: "This computer",
  },
  settings: {
    waveAccountNote:
      "Optional. Signed in, your song list, playlists, favorites, play history and preferences " +
      "go up to Wave's server, so your phones and this computer share them. Audio and file " +
      "paths never do.",
    waveAccountSignOutNote:
      "Signing out keeps your music files and plays on this computer. Songs from the account " +
      "with no file here leave the Library.",
    yourWaveSessionEndedSoThisPhone:
      "Your Wave session ended, so this computer is signed out. Sign in again to keep your backup.",
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
  },
  itemActions: {
    labels: {
      // A song's link is copied rather than sent from a share sheet.
      share: "Copy Link",
    },
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
