package expo.modules.wavenative.player

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand

/**
 * [AutoModes] in Media3 terms: the custom session commands behind the shuffle
 * and repeat buttons, the buttons themselves, and what the controllers that
 * show them (Auto, and the media notification, whose state legacy and platform
 * controllers such as Auto's share) may do.
 */
@OptIn(UnstableApi::class)
object AutoModesSession {
  val SHUFFLE = SessionCommand(AutoModes.SHUFFLE_ACTION, Bundle.EMPTY)
  val REPEAT = SessionCommand(AutoModes.REPEAT_ACTION, Bundle.EMPTY)

  /** Library commands plus the mode buttons' commands. */
  val sessionCommands
    get() = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
      .add(SHUFFLE)
      .add(REPEAT)
      .build()

  /** The default player commands without the player's own shuffle and repeat: JS's queue engine owns them. */
  val playerCommands
    get() = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
      .remove(Player.COMMAND_SET_SHUFFLE_MODE)
      .remove(Player.COMMAND_SET_REPEAT_MODE)
      .build()

  /** The buttons showing [modes], for the session's media button preferences. */
  fun buttons(modes: PlaybackModes): List<CommandButton> =
    AutoModes.buttons(modes).map { button ->
      CommandButton.Builder(icon(button.icon))
        .setSessionCommand(if (button.action == AutoModes.SHUFFLE_ACTION) SHUFFLE else REPEAT)
        .setDisplayName(button.label)
        .setSlots(CommandButton.SLOT_OVERFLOW)
        .build()
    }

  private fun icon(icon: ModeIcon): Int =
    when (icon) {
      ModeIcon.SHUFFLE_ON -> CommandButton.ICON_SHUFFLE_ON
      ModeIcon.SHUFFLE_OFF -> CommandButton.ICON_SHUFFLE_OFF
      ModeIcon.REPEAT_OFF -> CommandButton.ICON_REPEAT_OFF
      ModeIcon.REPEAT_ALL -> CommandButton.ICON_REPEAT_ALL
      ModeIcon.REPEAT_ONE -> CommandButton.ICON_REPEAT_ONE
    }
}
