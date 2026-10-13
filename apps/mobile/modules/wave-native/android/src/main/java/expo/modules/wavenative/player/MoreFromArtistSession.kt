package expo.modules.wavenative.player

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands

/** [MoreFromArtist] in Media3 terms: its custom session command and overflow button. */
@OptIn(UnstableApi::class)
object MoreFromArtistSession {
  val COMMAND = SessionCommand(MoreFromArtist.ACTION, Bundle.EMPTY)

  /** [commands] plus this button's command. */
  fun withCommand(commands: SessionCommands): SessionCommands =
    commands.buildUpon().add(COMMAND).build()

  /** The button, after shuffle and repeat in the overflow menu. */
  val button: CommandButton
    get() = CommandButton.Builder(CommandButton.ICON_ARTIST)
      .setSessionCommand(COMMAND)
      .setDisplayName(MoreFromArtist.LABEL)
      .setSlots(CommandButton.SLOT_OVERFLOW)
      .build()
}
