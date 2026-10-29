package expo.modules.wavenative.player

/** Main-thread count for Recognize. Android's public playback list hides every player's UID. */
object ActiveWaveAudio {
  var count: () -> Int = { 0 }
}
