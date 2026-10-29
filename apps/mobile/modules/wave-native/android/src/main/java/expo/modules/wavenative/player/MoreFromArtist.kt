package expo.modules.wavenative.player

import expo.modules.wavenative.locale.NativeText
/**
 * More from this artist, in the overflow menu of Auto's player screen next to
 * shuffle and repeat. A custom session command like theirs: a tap is forwarded
 * to JS, whose queue engine adds the current artist's next most played songs
 * after the current track (Core's `moreFromArtist`). Plain Kotlin, so it is
 * JVM-testable; [MoreFromArtistSession] makes it a Media3 command and button.
 */
object MoreFromArtist {
  const val ACTION = "expo.modules.wavenative.AUTO_MORE_FROM_ARTIST"
  val LABEL get() = NativeText.get("moreArtist")

  /** The bridge request a tap on [action] sends, or null when it isn't this button. */
  fun request(action: String): AutoCommandRequest? =
    if (action == ACTION) {
      AutoCommandRequest(AutoModes.ACTIONS_TYPE, """{"command":"moreFromArtist"}""")
    } else {
      null
    }
}
