package expo.modules.wavenative.player

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.ForwardingSimpleBasePlayer
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
 * The player the media session shows: [player] as it is, except that the
 * artwork is the lyrics image [artworkFor] gives for the current item (its
 * entry key and cover file), when it gives one. Only the session's metadata
 * changes: the items, and so what Wave's own controller and the resume
 * snapshot read, keep their cover. Call [refresh] when [artworkFor] would
 * answer differently.
 */
@OptIn(UnstableApi::class)
class LyricArtworkPlayer(
  player: Player,
  private val artworkFor: (itemId: String?, coverPath: String?) -> String?,
) : ForwardingSimpleBasePlayer(player) {
  override fun getState(): State {
    val state = super.getState()
    if (state.timeline.isEmpty) return state
    val item = player.currentMediaItem
    val cover = item?.mediaMetadata?.extras?.getString(PlayerMediaItems.ARTWORK_PATH)
    val artwork = artworkFor(item?.mediaId, cover) ?: return state
    val metadata = state.currentMetadata.buildUpon()
      // A picture embedded in the file would win over the URI in Media3's bitmap loader.
      .setArtworkData(null, null)
      .setArtworkUri(Uri.parse(artwork))
      .build()
    return state.buildUpon().setPlaylist(state.timeline, state.currentTracks, metadata).build()
  }

  /** Shows the artwork [artworkFor] gives now. */
  fun refresh() = invalidateState()
}
