package expo.modules.wavenative.player

import android.content.Context
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands

/**
 * [AutoLyrics] in Media3 terms: the custom session command behind the Lyrics
 * toggle and its button in the overflow menu of Auto's player screen.
 */
@OptIn(UnstableApi::class)
object AutoLyricsSession {
  val TOGGLE = SessionCommand(AutoLyrics.TOGGLE_ACTION, Bundle.EMPTY)

  /** [commands] plus the toggle's. */
  fun withCommand(commands: SessionCommands): SessionCommands =
    commands.buildUpon().add(TOGGLE).build()

  /** The toggle showing [on], for the session's media button preferences. */
  fun button(on: Boolean): CommandButton =
    CommandButton.Builder(if (on) CommandButton.ICON_SUBTITLES else CommandButton.ICON_SUBTITLES_OFF)
      .setSessionCommand(TOGGLE)
      .setDisplayName(AutoLyrics.label(on))
      .setSlots(CommandButton.SLOT_OVERFLOW)
      .build()
}

/** Keeps the Lyrics toggle in Wave's shared preferences, so it survives drives and restarts. */
class PreferencesLyricsToggleStore(context: Context) : LyricsToggleStore {
  private val preferences = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  override fun load() = preferences.getBoolean(KEY, false)

  override fun save(on: Boolean) {
    preferences.edit().putBoolean(KEY, on).apply()
  }

  private companion object {
    const val FILE = "wave-auto"
    const val KEY = "lyrics"
  }
}

/**
 * [this] with the title and artist [text] gives in place of the track's own:
 * the title is the line being sung and the artist the next one, or the
 * track's own artist when [text] has none. Without [text], [this] as it is.
 */
fun MediaMetadata.withLyrics(text: LyricsText?): MediaMetadata {
  text ?: return this
  val builder = buildUpon().setTitle(text.title)
  text.artist?.let { builder.setArtist(it) }
  return builder.build()
}

/**
 * The player the media session shows: [player] as it is, except that the
 * current item's title and artist show the lyrics [textFor] gives for it (its
 * entry key), when it gives some ([withLyrics]). Only the session's metadata
 * changes: the items, and so Auto's queue, what Wave's own controller and the
 * resume snapshot read, keep their title and artist. Call [refresh] when
 * [textFor] would answer differently.
 */
@OptIn(UnstableApi::class)
class LyricsTextPlayer(
  player: Player,
  private val textFor: (itemId: String?) -> LyricsText?,
) : ForwardingSimpleBasePlayer(player) {
  override fun getState(): State {
    val state = super.getState()
    if (state.timeline.isEmpty) return state
    val text = textFor(player.currentMediaItem?.mediaId) ?: return state
    val metadata = state.currentMetadata.withLyrics(text)
    return state.buildUpon().setPlaylist(state.timeline, state.currentTracks, metadata).build()
  }

  /** Shows the text [textFor] gives now. */
  fun refresh() = invalidateState()
}
